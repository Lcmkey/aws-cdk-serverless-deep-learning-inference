# Welcome to your CDK TypeScript project!

This is a blank project for TypeScript development with CDK.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template


# How to run

1. Install the AWS CDK and bootstrap the target account (if this was never done before)

    ```properties
    $ npm install -g aws-cdk
    $ cdk bootstrap aws://{account_id}/{region}
    ```

2. Install packages for the project

    ```properties
    $ npm i
    ```

3. List all Stacks

    ```properties
    $ cdk ls
    ```

4. Deploy to AWS

    ```properties
    $ cdk deploy
    ```

    Outputs:

        Serverless-Deep-Learning-Inference-Dev-LambdaEFSMLStack.LambdaFunctionName = Serverless-Deep-Learning-Inference-Dev-Lambda


    > It takes a few minutes for AWS CodeBuild to deploy the libraries and framework to EFS. To test the Lambda function, run this command, replacing the function name:

5. Test

    ```properties
    $ aws lambda invoke \
        --function-name Serverless-Deep-Learning-Inference-Dev-Lambda \
        --region us-east-1 \
        --cli-binary-format raw-in-base64-out \
        --payload '{"url": "https://www.apple.com/ac/structured-data/images/open_graph_logo.png"}' \
        --region us-east-1 \
        /tmp/return.json    
    ```

    This is the output:

    ```
    {
        "StatusCode": 200,
        "ExecutedVersion": "$LATEST"
    }
    ```

    Here you can check the inference’s result:

    ```properties
    $ tail /tmp/return.json 
    ```