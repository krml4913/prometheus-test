import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc } from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as logs from "aws-cdk-lib/aws-logs"
import * as iam from "aws-cdk-lib/aws-iam"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"

const PROMETHEUS_CONFIG_CONTENT = `
global:
  scrape_interval: 1m
  scrape_timeout: 10s
scrape_configs:
  - job_name: cwagent-static-config
    sample_limit: 10000
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ['127.0.0.1:8080']
    relabel_configs:
      - source_labels: [TaskId]
        target_label: instance
`;


function getCWConfig(logGroupName: string) {
  return JSON.stringify({
    agent: {
      debug: false,
    },
    logs: {
      metrics_collected: {
        prometheus: {
          log_group_name: logGroupName,
          prometheus_config_path: "env:PROMETHEUS_CONFIG_CONTENT",
          emf_processor: {
            metric_namespace: "CWAgent",
            metric_unit: {
              "jvm_threads_current": "Count",
              "jvm_classes_loaded": "Count",
              "java_lang_operatingsystem_freephysicalmemorysize": "Bytes",
              "catalina_manager_activesessions": "Count",
              "jvm_gc_collection_seconds_sum": "Seconds",
              "catalina_globalrequestprocessor_bytesreceived": "Bytes",
              "jvm_memory_used_bytes": "Bytes",
              "jvm_memory_pool_bytes_used": "Bytes"
            },
            metric_declaration: [
              {
                "source_labels": ["job"],
                label_matcher: "^cwagent-static-config$",
                "dimensions": [["area"], ["id"]],
                "metric_selectors": [
                  "^jvm_memory_used_bytes$"
                ]
              },
              {
                "source_labels": ["job"],
                label_matcher: "^cwagent-static-config$",
                "dimensions": [["area", "id"]],
                "metric_selectors": [
                  "^jvm_memory_committed_bytes$"
                ]
              },
              {
                "source_labels": ["job"],
                label_matcher: "^cwagent-static-config$",
                "dimensions": [["ClusterName", "action", "cause"]],
                "metric_selectors": [
                  "^jvm_gc_pause_seconds_count$"
                ]
              },
            ],
          },
        },
      },
      force_flush_interval: 5,
    },
  });
}

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ecr
    const repo = new ecr.Repository(this, 'SSSECR')

    // ecs
    const vpc = new Vpc(this, 'SSSVpc', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'SSSCluster', { vpc, containerInsights: true });

    const taskRole = new iam.Role(this, "ecs-task-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      // ECSタスクからCloudWatchメトリクスをputできるように
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "CloudWatchAgentServerPolicy"
        ),
      ],
    });
    const logGroup = new logs.LogGroup(this, "log-group", {
      logGroupName: `/ecs/cloudwatch-agent`,
      retention: 7,
      removalPolicy: RemovalPolicy.DESTROY,
    });


    // Instantiate Fargate Service with just cluster and image
    const service = new ApplicationLoadBalancedFargateService(this, "FargateService", {
      cluster,
      taskImageOptions: {
        containerName: "Spring-Prometheus",
        image: ecs.ContainerImage.fromEcrRepository(repo),
        containerPort: 8080,
        taskRole,
      },
      desiredCount: 2
    });
    service.targetGroup.configureHealthCheck({
      path: "/actuator/health"
    })
    service.taskDefinition.addContainer(
      "cloudwatch-agent",
      {
        image: ecs.ContainerImage.fromRegistry(
          "public.ecr.aws/cloudwatch-agent/cloudwatch-agent:latest"
        ),
        environment: {
          PROMETHEUS_CONFIG_CONTENT,
          CW_CONFIG_CONTENT: getCWConfig(logGroup.logGroupName),
        },
        memoryReservationMiB: 50,
        logging: new ecs.AwsLogDriver({
          streamPrefix: "ecs",
          logGroup,
        }),
      }
    )
  }
}
