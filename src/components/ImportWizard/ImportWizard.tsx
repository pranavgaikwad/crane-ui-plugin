import * as React from 'react';
import * as yaml from 'js-yaml';
import {
  Wizard,
  WizardFooter,
  WizardContextConsumer,
  Button,
  Tooltip,
  WizardStepFunctionType,
} from '@patternfly/react-core';
import wizardStyles from '@patternfly/react-styles/css/components/Wizard/wizard';
import { IFormState, ResolvedQueries } from '@konveyor/lib-ui';
import { useHistory } from 'react-router-dom';

import { useNamespaceContext } from 'src/context/NamespaceContext';
import { SourceClusterProjectStep } from './SourceClusterProjectStep';
import { SourceProjectDetailsStep } from './SourceProjectDetailsStep';
import { PVCSelectStep } from './PVCSelectStep';
import { PVCEditStep } from './PVCEditStep';
import { PipelineSettingsStep } from './PipelineSettingsStep';
import { ReviewStep } from './ReviewStep';
import { ImportWizardFormContext, useImportWizardFormState } from './ImportWizardFormContext';
import { useConfigureDestinationSecretMutation } from 'src/api/queries/secrets';
import {
  formsToTektonResources,
  WizardTektonResources,
  yamlToTektonResources,
} from 'src/api/pipelineHelpers';
import { useCreateTektonResourcesMutation } from 'src/api/queries/pipelines';

import './ImportWizard.css';
import { getYamlFieldKeys } from './helpers';
import { ConfirmModal } from 'src/common/components/ConfirmModal';
import { RouteGuard } from 'src/common/components/RouteGuard';
import { TemporaryCertErrorModal } from './TemporaryCertErrorModal';

enum StepId {
  SourceClusterProject = 0,
  SourceProjectDetails,
  PVCSelect,
  PVCEdit,
  PipelineSettings,
  Review,
}

export const ImportWizard: React.FunctionComponent = () => {
  const history = useHistory();

  const forms = useImportWizardFormState();

  const formsByStepId: Record<StepId, IFormState<unknown> | null> = {
    [StepId.SourceClusterProject]: forms.sourceClusterProject,
    [StepId.SourceProjectDetails]: null,
    [StepId.PVCSelect]: forms.pvcSelect,
    [StepId.PVCEdit]: forms.pvcEdit,
    [StepId.PipelineSettings]: forms.pipelineSettings,
    [StepId.Review]: forms.review,
  };
  const hiddenStepIds = forms.pvcSelect.values.selectedPVCs.length === 0 ? [StepId.PVCEdit] : [];
  const nextVisibleStep = (currentStepId: StepId) => {
    let newStepId = currentStepId + 1;
    while (hiddenStepIds.includes(newStepId)) newStepId++;
    return newStepId;
  };
  const prevVisibleStep = (currentStepId: StepId) => {
    let newStepId = currentStepId - 1;
    while (hiddenStepIds.includes(newStepId)) newStepId--;
    return newStepId;
  };

  const firstInvalidFormStepId = (Object.values(StepId) as StepId[]).find(
    (id: StepId) => formsByStepId[id] && !hiddenStepIds.includes(id) && !formsByStepId[id]?.isValid,
  );
  const stepIdReached =
    firstInvalidFormStepId !== undefined ? firstInvalidFormStepId : StepId.Review + 1;

  const somePVRowIsEditMode = Object.values(forms.pvcEdit.values.isEditModeByPVC).some(
    (isEditMode) => isEditMode,
  );
  const allNavDisabled = somePVRowIsEditMode;
  const navDisabledReason = somePVRowIsEditMode
    ? 'Confirm or cancel row edits before proceeding'
    : null;
  const canMoveToStep = (stepId: StepId) =>
    !allNavDisabled && stepId >= 0 && stepIdReached >= stepId;

  const namespace = useNamespaceContext();

  const configureDestinationSecretMutation = useConfigureDestinationSecretMutation({
    existingSecretFromState: forms.review.values.destinationApiSecret,
    onSuccess: (newSecret) => {
      forms.review.fields.destinationApiSecret.setValue(newSecret);
      const tektonResources = formsToTektonResources(forms, newSecret, namespace);
      if (tektonResources.stagePipeline && tektonResources.stagePipelineRun) {
        forms.review.fields.stagePipelineYaml.prefill(yaml.dump(tektonResources.stagePipeline));
        forms.review.fields.stagePipelineRunYaml.prefill(
          yaml.dump(tektonResources.stagePipelineRun),
        );
      }
      forms.review.fields.cutoverPipelineYaml.prefill(yaml.dump(tektonResources.cutoverPipeline));
      forms.review.fields.cutoverPipelineRunYaml.prefill(
        yaml.dump(tektonResources.cutoverPipelineRun),
      );
    },
  });

  const onMoveToStep: WizardStepFunctionType = (newStep, prevStep) => {
    if (newStep.id === StepId.Review) {
      // Triggers prefilling of Tekton resource YAML in review step form fields
      configureDestinationSecretMutation.mutate();
    }
    if (prevStep.prevId === StepId.Review) {
      configureDestinationSecretMutation.reset();
      createTektonResourcesMutation.reset();
      forms.review.fields.stagePipelineYaml.reinitialize('');
      forms.review.fields.stagePipelineRunYaml.reinitialize('');
      forms.review.fields.cutoverPipelineYaml.reinitialize('');
      forms.review.fields.cutoverPipelineRunYaml.reinitialize('');
    }
  };

  const createTektonResourcesMutation = useCreateTektonResourcesMutation((newResources) => {
    // On success, navigate to the Tekton UI!
    const pipelineRuns = [newResources.stagePipelineRun, newResources.cutoverPipelineRun].filter(
      (plr) => !!plr,
    );
    const pipelineRunsUrl = `/k8s/ns/${namespace}/tekton.dev~v1beta1~PipelineRun`;
    history.push(
      pipelineRuns.length === 1
        ? `${pipelineRunsUrl}/${newResources.cutoverPipelineRun.metadata?.name}`
        : pipelineRunsUrl,
    );
  });

  const onSubmitWizard = () => {
    const tektonResources = yamlToTektonResources(forms);
    if (forms.review.isValid) {
      createTektonResourcesMutation.mutate({
        resources: tektonResources as WizardTektonResources, // If there are no validation errors, we know the required resources will be defined
        secrets: [
          forms.sourceClusterProject.values.sourceApiSecret,
          forms.review.values.destinationApiSecret,
        ],
      });
    }
  };

  const isStatefulMigration = forms.pvcSelect.values.selectedPVCs.length > 0;
  const yamlFieldKeys = getYamlFieldKeys(isStatefulMigration);
  const hasUnsavedYamlChanges = yamlFieldKeys.some(
    (fieldKey) => forms.review.fields[fieldKey].isDirty,
  );
  const [isResetYamlConfirmModalOpen, setIsResetYamlConfirmModalOpen] = React.useState(false);

  return (
    <ImportWizardFormContext.Provider value={forms}>
      <TemporaryCertErrorModal />
      <RouteGuard
        when={forms.isSomeFormDirty && createTektonResourcesMutation.status === 'idle'}
        title="Leave this page?"
        message="All unsaved changes will be lost."
      />
      <Wizard
        id="crane-import-wizard"
        steps={[
          {
            name: 'Source information',
            steps: [
              {
                id: StepId.SourceClusterProject,
                name: 'Cluster and project',
                component: <SourceClusterProjectStep />,
                canJumpTo: canMoveToStep(StepId.SourceClusterProject) && !hasUnsavedYamlChanges,
              },
              {
                id: StepId.SourceProjectDetails,
                name: 'Project details',
                component: <SourceProjectDetailsStep />,
                canJumpTo: canMoveToStep(StepId.SourceProjectDetails) && !hasUnsavedYamlChanges,
              },
            ],
          },
          {
            name: 'Persistent volume claims',
            steps: [
              {
                id: StepId.PVCSelect,
                name: 'Select',
                component: <PVCSelectStep />,
                canJumpTo: canMoveToStep(StepId.PVCSelect) && !hasUnsavedYamlChanges,
              },
              ...(!hiddenStepIds.includes(StepId.PVCEdit)
                ? [
                    {
                      id: StepId.PVCEdit,
                      name: 'Edit',
                      component: <PVCEditStep />,
                      canJumpTo: canMoveToStep(StepId.PVCEdit) && !hasUnsavedYamlChanges,
                    },
                  ]
                : []),
            ],
          },
          {
            id: StepId.PipelineSettings,
            name: 'Pipeline settings',
            component: <PipelineSettingsStep />,
            canJumpTo: canMoveToStep(StepId.PipelineSettings) && !hasUnsavedYamlChanges,
          },
          {
            id: StepId.Review,
            name: 'Review',
            component: (
              <ResolvedQueries
                resultsWithErrorTitles={[
                  {
                    result: configureDestinationSecretMutation,
                    errorTitle: 'Cannot configure destination cluster secret',
                  },
                  {
                    result: createTektonResourcesMutation,
                    errorTitle: 'Cannot create Pipeline and PipelineRun',
                  },
                ]}
                forceLoadingState={createTektonResourcesMutation.isSuccess}
              >
                <ReviewStep />
              </ResolvedQueries>
            ),
            canJumpTo: canMoveToStep(StepId.Review),
          },
        ]}
        onSubmit={(event) => event.preventDefault()}
        onSave={onSubmitWizard}
        onClose={() => history.push(`/add/ns/${namespace}`)}
        onNext={onMoveToStep}
        onBack={onMoveToStep}
        onGoToStep={onMoveToStep}
        footer={
          <WizardFooter>
            <WizardContextConsumer>
              {({ activeStep, onNext, onBack, onClose }) => {
                const onFinalStep = activeStep.id === StepId.Review;
                const isNextDisabled =
                  !canMoveToStep(nextVisibleStep(activeStep.id as StepId)) ||
                  createTektonResourcesMutation.status === 'loading';
                const isBackDisabled = !canMoveToStep(prevVisibleStep(activeStep.id as StepId));

                const onBackClick = () => {
                  if (activeStep.id === StepId.Review && hasUnsavedYamlChanges) {
                    setIsResetYamlConfirmModalOpen(true);
                  } else {
                    onBack();
                  }
                };

                return (
                  <>
                    <Tooltip
                      content={navDisabledReason}
                      trigger={navDisabledReason ? 'mouseenter focus' : ''}
                    >
                      <Button
                        variant="primary"
                        type="submit"
                        onClick={onNext}
                        isAriaDisabled={isNextDisabled}
                      >
                        {onFinalStep ? 'Finish' : 'Next'}
                      </Button>
                    </Tooltip>
                    <Tooltip
                      content={navDisabledReason}
                      trigger={navDisabledReason ? 'mouseenter focus' : ''}
                    >
                      <Button
                        variant="secondary"
                        onClick={onBackClick}
                        isAriaDisabled={isBackDisabled}
                      >
                        Back
                      </Button>
                    </Tooltip>
                    <div className={wizardStyles.wizardFooterCancel}>
                      <Button variant="link" onClick={onClose}>
                        Cancel
                      </Button>
                    </div>
                    <ConfirmModal
                      title="Discard YAML changes?"
                      isOpen={isResetYamlConfirmModalOpen}
                      toggleOpen={() =>
                        setIsResetYamlConfirmModalOpen(!isResetYamlConfirmModalOpen)
                      }
                      mutateFn={() => {
                        setIsResetYamlConfirmModalOpen(false);
                        onBack();
                      }}
                      confirmButtonText="Discard"
                      body="Moving back through the wizard will discard the changes you have made to the YAML on this step."
                    />
                  </>
                );
              }}
            </WizardContextConsumer>
          </WizardFooter>
        }
      />
    </ImportWizardFormContext.Provider>
  );
};
