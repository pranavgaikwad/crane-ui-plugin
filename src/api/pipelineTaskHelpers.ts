import { ImportWizardFormState } from 'src/components/ImportWizard/ImportWizardFormContext';
import { PipelineTask } from 'src/reused/pipelines-plugin/src/types';

export const getAllPipelineTasks = (forms: ImportWizardFormState, namespace: string) => {
  const { sourceNamespace } = forms.sourceClusterProject.values;
  const { selectedPVCs } = forms.pvcSelect.values;
  const { editValuesByPVC } = forms.pvcEdit.values;

  const generateSourceKubeconfigTask: PipelineTask = {
    name: 'generate-source-kubeconfig',
    params: [
      { name: 'cluster-secret', value: '$(params.source-cluster-secret)' },
      { name: 'context-name', value: 'source' },
    ],
    taskRef: { name: 'crane-kubeconfig-generator', kind: 'ClusterTask' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  const generateDestinationKubeconfigTask: PipelineTask = {
    name: 'generate-destination-kubeconfig',
    runAfter: ['generate-source-kubeconfig'],
    params: [
      { name: 'cluster-secret', value: '$(params.destination-cluster-secret)' },
      { name: 'context-name', value: 'destination' },
    ],
    taskRef: { name: 'crane-kubeconfig-generator', kind: 'ClusterTask' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  const craneExportTask: PipelineTask = {
    name: 'export',
    params: [
      { name: 'context', value: 'source' },
      { name: 'namespace', value: '$(params.source-namespace)' },
    ],
    runAfter: ['generate-destination-kubeconfig'],
    taskRef: { kind: 'ClusterTask', name: 'crane-export' },
    workspaces: [
      { name: 'export', subPath: 'export', workspace: 'shared-data' },
      { name: 'kubeconfig', workspace: 'kubeconfig' },
    ],
  };

  const craneTransformTask: PipelineTask = {
    name: 'transform',
    runAfter: ['export'],
    params: [],
    taskRef: { name: 'crane-transform', kind: 'ClusterTask' },
    workspaces: [
      { name: 'export', workspace: 'shared-data', subPath: 'export' },
      { name: 'transform', workspace: 'shared-data', subPath: 'transform' },
    ],
  };

  const craneApplyTask: PipelineTask = {
    name: 'apply',
    runAfter: ['transform'],
    taskRef: { name: 'crane-apply', kind: 'ClusterTask' },
    workspaces: [
      { name: 'export', workspace: 'shared-data', subPath: 'export' },
      { name: 'transform', workspace: 'shared-data', subPath: 'transform' },
      { name: 'apply', workspace: 'shared-data', subPath: 'apply' },
    ],
  };

  const kustomizeInitTask: PipelineTask = {
    name: 'kustomize-init',
    runAfter: ['apply'],
    params: [
      { name: 'source-namespace', value: '$(params.source-namespace)' },
      { name: 'namespace', value: '$(context.taskRun.namespace)' },
    ],
    taskRef: { name: 'crane-kustomize-init', kind: 'ClusterTask' },
    workspaces: [
      { name: 'apply', workspace: 'shared-data', subPath: 'apply' },
      { name: 'kustomize', workspace: 'shared-data' },
    ],
  };

  const kubectlApplyKustomizeTask: PipelineTask = {
    name: 'kubectl-apply-kustomize',
    runAfter: ['kustomize-init'],
    params: [{ name: 'context', value: 'destination' }],
    taskRef: { name: 'kubectl-apply-kustomize', kind: 'ClusterTask' },
    workspaces: [
      { name: 'kustomize', workspace: 'shared-data' },
      { name: 'kubeconfig', workspace: 'kubeconfig' },
    ],
  };

  const quiesceDeploymentsTask: PipelineTask = {
    name: 'quiesce-deployments',
    params: [
      { name: 'context', value: 'source' },
      { name: 'namespace', value: '$(params.source-namespace)' },
      { name: 'resource-type', value: 'deployment' },
    ],
    runAfter: ['export'],
    taskRef: { kind: 'ClusterTask', name: 'kubectl-scale-down' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  const quiesceDeploymentConfigsTask: PipelineTask = {
    name: 'quiesce-deploymentconfigs',
    params: [
      { name: 'context', value: 'source' },
      { name: 'namespace', value: '$(params.source-namespace)' },
      { name: 'resource-type', value: 'deploymentconfig' },
    ],
    runAfter: ['export'],
    taskRef: { kind: 'ClusterTask', name: 'kubectl-scale-down' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  const quiesceStatefulSetsTask: PipelineTask = {
    name: 'quiesce-statefulsets',
    params: [
      { name: 'context', value: 'source' },
      { name: 'namespace', value: '$(params.source-namespace)' },
      { name: 'resource-type', value: 'statefulset' },
    ],
    runAfter: ['export'],
    taskRef: { kind: 'ClusterTask', name: 'kubectl-scale-down' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  const quiesceJobsTask: PipelineTask = {
    name: 'quiesce-jobs',
    params: [
      { name: 'context', value: 'source' },
      { name: 'namespace', value: '$(params.source-namespace)' },
      { name: 'resource-type', value: 'job' },
    ],
    runAfter: ['export'],
    taskRef: { kind: 'ClusterTask', name: 'kubectl-scale-down' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  const transferPvcTasks: PipelineTask[] = selectedPVCs.map((pvc) => {
    const editValues = editValuesByPVC[pvc.metadata?.name || ''];
    const { targetPvcName, storageClass, capacity, verifyCopy } = editValues; // TODO where to put verifyCopy?
    console.log('TODO: use verifyCopy flag!', pvc.metadata?.name, verifyCopy);
    return {
      name: 'transfer-pvc',
      params: [
        { name: 'source-context', value: 'source' },
        { name: 'source-namespace', value: sourceNamespace },
        { name: 'source-pvc-name', value: pvc.metadata?.name },
        { name: 'dest-context', value: 'destination' },
        { name: 'dest-pvc-name', value: targetPvcName },
        { name: 'dest-namespace', value: namespace },
        { name: 'dest-storage-class-name', value: storageClass },
        { name: 'dest-pvc-capacity', value: capacity },
        { name: 'endpoint-type', value: 'route' },
      ],
      taskRef: { kind: 'ClusterTask', name: 'crane-transfer-pvc' },
      workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
    };
  });

  const chownTask = {
    name: 'chown',
    params: [
      { name: 'pvcs', value: selectedPVCs.map((pvc) => pvc.metadata?.name).join(',') },
      { name: 'namespace', value: '$(params.source-namespace)' },
      { name: 'context', value: 'destination' },
    ],
    runAfter: ['transfer-pvc'],
    taskRef: { kind: 'ClusterTask', name: 'crane-ownership-change' },
    workspaces: [{ name: 'kubeconfig', workspace: 'kubeconfig' }],
  };

  return {
    generateSourceKubeconfigTask,
    generateDestinationKubeconfigTask,
    craneExportTask,
    craneTransformTask,
    craneApplyTask,
    kustomizeInitTask,
    kubectlApplyKustomizeTask,
    quiesceDeploymentsTask,
    quiesceDeploymentConfigsTask,
    quiesceStatefulSetsTask,
    quiesceJobsTask,
    transferPvcTasks,
    chownTask,
  };
};
