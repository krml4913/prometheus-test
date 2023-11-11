import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc } from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns"

export class CdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ecr
    const repo = new ecr.Repository(this, 'SSSECR')

    // ecs
    const vpc = new Vpc(this, 'SSSVpc', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'SSSCluster', { vpc });


    // Instantiate Fargate Service with just cluster and image
    const service= new ApplicationLoadBalancedFargateService(this, "FargateService", {
      cluster,
      taskImageOptions: {
        containerName: "Spring-Prometheus",
        image: ecs.ContainerImage.fromEcrRepository(repo),
        containerPort: 8080
      },
      desiredCount: 1
    });
    service.targetGroup.configureHealthCheck({
      path: "/actuator/health"
    })
  }
}
