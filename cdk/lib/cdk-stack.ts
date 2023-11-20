import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc } from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as logs from "aws-cdk-lib/aws-logs"
import * as iam from "aws-cdk-lib/aws-iam"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"


const jobName = 'prometheus-job'
const PROMETHEUS_CONFIG_CONTENT = `
global:
  scrape_interval: 1m
  scrape_timeout: 10s
scrape_configs:
  - job_name: prometheus-job
    sample_limit: 10000
    file_sd_configs:
      - files: ["/tmp/cwagent_ecs_auto_sd.yaml"]
`;

function getCWConfig(logGroupName: string) {
  return {
    agent: {
      debug: true,
    },
    logs: {
      metrics_collected: {
        prometheus: {
          log_group_name: logGroupName,
          prometheus_config_path: 'env:PROMETHEUS_CONFIG_CONTENT',
          ecs_service_discovery: {
            sd_frequency: '1m',
            // sd_target_cluster: 'CdkStack-SSSCluster90BAF0F9-2k6PyxRWvmo7',
            sd_result_file: '/tmp/cwagent_ecs_auto_sd.yaml',
            service_name_list_for_tasks: [
              {
                sd_job_name: 'prometheus-job',
                sd_metrics_ports: '8080',
                sd_service_name_pattern: `.*`,
                sd_metrics_path: '/actuator/prometheus',
              },
            ],
          },
          emf_processor: {
            metric_namespace: 'Prometheus',
            metric_unit: {
              jvm_threads_current: 'Count',
              jvm_classes_loaded: 'Count',
              java_lang_operatingsystem_freephysicalmemorysize: 'Bytes',
              catalina_manager_activesessions: 'Count',
              jvm_gc_collection_seconds_sum: 'Seconds',
              catalina_globalrequestprocessor_bytesreceived: 'Bytes',
              jvm_memory_used_bytes: 'Bytes',
              jvm_memory_pool_bytes_used: 'Bytes',
            },
            metric_declaration: [
              {
                source_labels: ['job'],
                label_matcher: '^prometheus-job$',
                dimensions: [['ClusterName','area', 'id']],
                metric_selectors: ['^jvm_memory_used_bytes$'],
              },
              {
                source_labels: ['job'],
                label_matcher: '^prometheus-job$',
                dimensions: [['ClusterName','area', 'id']],
                metric_selectors: ['^jvm_memory_committed_bytes$'],
              },
              {
                source_labels: ['job'],
                label_matcher: '^prometheus-job$',
                dimensions: [['ClusterName', 'action', 'cause']],
                metric_selectors: ['^jvm_gc_pause_seconds_count$'],
              },
            ],
          },
        },
      },
      force_flush_interval: 5,
    },
  }
}

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ecr
    const repo = new ecr.Repository(this, 'SSSECR')

    // ecs
    const vpc = new Vpc(this, 'SSSVpc', { maxAzs: 2 });
    const taskRole = this.createTaskRole();

    const cluster = this.createAppCluster(vpc, repo, taskRole);

    /**
     * CloudWatchAgentここから
     */
    const logGroup = new logs.LogGroup(this, "log-group", {
      logGroupName: `/ecs/cloudwatch-agent`,
      retention: 7,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // const cwaCluster = new ecs.Cluster(this, 'cwa-cluster', {
    //   clusterName: 'cwa-cluster',
    //   containerInsights: false,
    //   vpc,
    // })
    // ECSタスク実行用IAMロール作成
    const ecsTaskExecutionRole = new iam.Role(this, "ecs-task-execution-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "CloudWatchAgentServerPolicy"
        ),
      ],
    });
    const fargateTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "cloudwatch-agent-task",
      {
        family: "cloudwatch-agent",
        cpu: 256,
        memoryLimitMiB: 512,
        taskRole: taskRole,
        executionRole: ecsTaskExecutionRole
      }
    );
    fargateTaskDefinition.addContainer(
      "cloudwatch-agent",
      {
        image: ecs.ContainerImage.fromRegistry(
          "public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest"
        ),
        essential: true,
        environment: {
          PROMETHEUS_CONFIG_CONTENT,
          CW_CONFIG_CONTENT: JSON.stringify(
            getCWConfig(logGroup.logGroupName)
          ),
        },
        memoryReservationMiB: 50,
        portMappings: [{ containerPort: 8080 }],
        logging: new ecs.AwsLogDriver({
          streamPrefix: "ecs",
          logGroup,
        }),
      }
    );
    const service = new ecs.FargateService(this, "cloudwatch-agent-service", {
      cluster: cluster,
      serviceName: "cwa-service",
      taskDefinition: fargateTaskDefinition,
      enableExecuteCommand: true,
      desiredCount: 1,
    });
  }

  private createAppCluster(vpc: Vpc, repo: ecr.Repository, taskRole: iam.Role) {
    const appCluster = new ecs.Cluster(this, 'SSSCluster', { vpc, containerInsights: true });
    const appService = new ApplicationLoadBalancedFargateService(this, "FargateService", {
      cluster: appCluster,
      taskImageOptions: {
        containerName: "Spring-Prometheus",
        image: ecs.ContainerImage.fromEcrRepository(repo),
        containerPort: 8080,
        taskRole,
      },
      desiredCount: 2
    });
    appService.targetGroup.configureHealthCheck({
      path: "/actuator/health"
    });

    return appCluster;
  }

  private createTaskRole() {
    const taskRole = new iam.Role(this, "ecs-task-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      // ECSタスクからCloudWatchメトリクスをputできるように
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "CloudWatchAgentServerPolicy"
        ),
      ],
    });
    new iam.Policy(this, "ecs-metrics", {
      roles: [taskRole],
      statements: [
        new iam.PolicyStatement({
          resources: ["*"],
          actions: [
            "ecs:ListTasks",
            "ecs:ListServices",
            "ecs:DescribeContainerInstances",
            "ecs:DescribeServices",
            "ecs:DescribeTasks",
            "ecs:DescribeTaskDefinition",
          ],
        }),
      ],
    });
    return taskRole;
  }
}
