import { Stack, App, StackProps, Duration, Size, RemovalPolicy, CfnOutput } from "@aws-cdk/core";
import { Vpc, SecurityGroup, Port, SubnetType } from "@aws-cdk/aws-ec2";
import { ManagedPolicy } from "@aws-cdk/aws-iam";
import { FileSystem, ThroughputMode, AccessPoint } from "@aws-cdk/aws-efs";
import { Project, BuildSpec, LinuxBuildImage, ComputeType, CfnProject } from "@aws-cdk/aws-codebuild";
import { AwsCustomResource, PhysicalResourceId, AwsCustomResourcePolicy } from "@aws-cdk/custom-resources";
import { Function, Runtime, Code, FileSystem as FileSystemLambda } from "@aws-cdk/aws-lambda"
import * as path from "path";

interface LambdaEFSMLStackProps extends StackProps {
  readonly prefix?: string;
  readonly stage?: string;
  readonly installPackages?: string;
}


type accessPointConfigType = {
  name: string;
  posixId: number;
  path: string;
}


export class LambdaEFSMLStack extends Stack {
  constructor(scope: App, id: string, props: LambdaEFSMLStackProps) {
    super(scope, id, props);


    /**
     * Get var from props
     */
    const { prefix, stage, installPackages } = props;

    /**
     * VPC definition
     */
    const vpc = new Vpc(this, `${prefix}-${stage}-Vpc`, {
      maxAzs: 2,
      natGateways: 1,
    });

    /**
     * Security Group definitions
     */
    const ec2SecurityGroup = new SecurityGroup(this, `${prefix}-${stage}-EC2-SG`, {
      vpc,
      securityGroupName: `${prefix}-${stage}-EC2-SG`,
      // allowAllOutbound: false,
    });

    const lambdaSecurityGroup = new SecurityGroup(this, `${prefix}-${stage}-Lambda-SG`, {
      vpc,
      securityGroupName: `${prefix}-${stage}-Lambda-SG`,
      // allowAllOutbound: false,
    });

    const efsSecurityGroup = new SecurityGroup(this, `${prefix}-${stage}-Efs-SG`, {
      vpc,
      securityGroupName: `${prefix}-${stage}-EFS-SG`,
      // allowAllOutbound: false,
    });

    /**
     * Grant Accrss to Security Group
     */
    ec2SecurityGroup.connections.allowTo(efsSecurityGroup, Port.tcp(2049));
    lambdaSecurityGroup.connections.allowTo(efsSecurityGroup, Port.tcp(2049));

    /**
     * Elastic File System file system.
     * For the purpose of cost saving, provisioned troughput has been kept low.
     */
    const fileSystem = new FileSystem(this, `${prefix}-${stage}-EFS`, {
      fileSystemName: `${prefix}-${stage}-EFS`,
      vpc: vpc,
      securityGroup: efsSecurityGroup,
      throughputMode: ThroughputMode.PROVISIONED,
      provisionedThroughputPerSecond: Size.mebibytes(10),
      removalPolicy: RemovalPolicy.DESTROY // not recommand to enable in production env
    });

    /**
     * Efs Access points
     */
    // const efsAccessPoint = new AccessPoint(this, `${prefix}-${stage}-EFS-Access-Point`, {
    //   fileSystem,
    //   path: "/lambda",
    //   posixUser: {
    //     gid: "1000",
    //     uid: "1000"
    //   },
    //   createAcl: {
    //     ownerGid: "1000",
    //     ownerUid: "1000",
    //     permissions: "777"
    //   }
    // });

    /*
     * Configuration for the Access Points we"re going to be creating so that we can do so iteratively.
     * Note that the "Common" Access Point is always created.
     */
    const accessPointConfigs: accessPointConfigType = {
      name: `${prefix}-${stage}-Common`,
      posixId: 1000,
      path: "/lambda"
    };

    const efsAccessPointCfnResrouce = new AwsCustomResource(
      fileSystem.stack,
      "EfsAccessPoint" + accessPointConfigs.name,
      {
        onUpdate: {
          action: "createAccessPoint",
          parameters: {
            FileSystemId: fileSystem.fileSystemId,
            PosixUser: {
              Gid: accessPointConfigs.posixId,
              Uid: accessPointConfigs.posixId,
            },
            RootDirectory: {
              CreationInfo: {
                OwnerGid: accessPointConfigs.posixId,
                OwnerUid: accessPointConfigs.posixId,
                Permissions: 777,
              },
              Path: accessPointConfigs.path,
            },
            Tags: [{ Key: "Name", Value: accessPointConfigs.name }],
          },
          physicalResourceId: PhysicalResourceId.fromResponse(
            "AccessPointArn",
          ),
          service: "EFS",
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
      },
    );

    const efsAccessPoint = AccessPoint.fromAccessPointAttributes(this, `${prefix}-${stage}-EFS-Access-Point`, {
      fileSystem,
      accessPointArn: efsAccessPointCfnResrouce.getResponseField("AccessPointArn"),
      // accessPointId: efsAccessPointCfnResrouce.getResponseField("AccessPointId"),
    });


    /**
     * Lambda function to execute inference
     */
    const lambdaHandler = new Function(this, `${prefix}-${stage}-Lambda`, {
      functionName: `${prefix}-${stage}-Lambda`,
      runtime: Runtime.PYTHON_3_8,
      handler: "main.lambda_handler",
      code: Code.fromAsset(path.join(__dirname, "..", "lambda")),
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: SubnetType.PRIVATE }),
      securityGroup: lambdaSecurityGroup,
      timeout: Duration.minutes(2),
      memorySize: 4096,
      reservedConcurrentExecutions: 10,
      filesystem: FileSystemLambda.fromEfsAccessPoint(efsAccessPoint, "/mnt/python")
    });

    /**
     * Grant Access to role
     */
    lambdaHandler.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticFileSystemClientFullAccess"));

    /**
     * Leveraging on AWS CodeBuild to install Python libraries to EFS
     */
    const codeBuildProject = new Project(this, `${prefix}-${stage}-EFS-CodeBuild-Project`, {
      projectName: `${prefix}-${stage}-EFS-CodeBuild-Project`,
      description: "Installs Python libraries to EFS.",
      vpc,
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              "echo 'Downloading and copying model...'",
              "mkdir -p $CODEBUILD_EFS1/lambda/model",
              "curl https://storage.googleapis.com/tfhub-modules/google/openimages_v4/ssd/mobilenet_v2/1.tar.gz --output /tmp/1.tar.gz",
              "tar zxf /tmp/1.tar.gz -C $CODEBUILD_EFS1/lambda/model",
              "echo 'Installing virtual environment...'",
              "mkdir -p $CODEBUILD_EFS1/lambda",
              "python3 -m venv $CODEBUILD_EFS1/lambda/tensorflow",
              "echo 'Installing Tensorflow...'",
              "source $CODEBUILD_EFS1/lambda/tensorflow/bin/activate && pip3 install " +
              (installPackages ? installPackages : "tensorflow"),
              "echo 'Changing folder permissions...'",
              "chown -R 1000:1000 $CODEBUILD_EFS1/lambda/"
            ]
          }
        },
      }),
      environment: {
        buildImage: LinuxBuildImage.fromDockerRegistry("lambci/lambda:build-python3.8"),
        computeType: ComputeType.LARGE,
        privileged: true,
      },
      securityGroups: [ec2SecurityGroup],
      subnetSelection: vpc.selectSubnets({ subnetType: SubnetType.PRIVATE }),
      timeout: Duration.minutes(30),
    });

    /**
     * Configure EFS for CodeBuild
     */
    const cfnProject = codeBuildProject.node.defaultChild as CfnProject;
    cfnProject.fileSystemLocations = [{
      type: "EFS",
      //location: fs.mountTargetsAvailable + ".efs." + Stack.of(this).region + ".amazonaws.com:/",
      location: fileSystem.fileSystemId + ".efs." + Stack.of(this).region + ".amazonaws.com:/",
      mountPoint: "/mnt/python",
      identifier: "efs1",
      mountOptions: "nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2"
    }];

    cfnProject.logsConfig = {
      cloudWatchLogs: {
        status: "ENABLED"
      }
    }

    /**
     * Triggers the CodeBuild project to install the python packages and model to the EFS file system
     */
    const triggerBuildProject = new AwsCustomResource(this, `${prefix}-${stage}-Trigger-CodeBuild`, {
      functionName: `${prefix}-${stage}-Trigger-CodeBuild`,
      onCreate: {
        service: "CodeBuild",
        action: "startBuild",
        parameters: {
          projectName: codeBuildProject.projectName
        },
        physicalResourceId: PhysicalResourceId.fromResponse("build.id"),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE })
    });

    /**
     * Create dependenct between EFS and Codebuild
     */
    lambdaHandler.node.addDependency(efsAccessPoint);
    codeBuildProject.node.addDependency(efsAccessPoint);

    // Output Lambda function name.
    new CfnOutput(this, "LambdaFunctionName", { value: lambdaHandler.functionName });
  }
}
