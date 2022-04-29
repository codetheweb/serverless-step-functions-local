# serverless-step-functions-local
Run AWS step functions offline with Serverless!

This is a plugin for the [Serverless Framework](https://serverless.com/).  It uses [stepfunctions-localhost](https://www.npmjs.com/package/stepfunctions-localhost) to emulate step functions with AWS' provided tool for local development.

## Requirements

- serverless >= v2.32.0
- The [serverless-offline](https://www.npmjs.com/package/serverless-offline) plugin
- The [serverless-offline-lambda](https://www.npmjs.com/package/serverless-offline-lambda) plugin
- The [serverless-step-functions](https://www.npmjs.com/package/serverless-step-functions) plugin
- Java Runtime Engine (JRE) version 6.x or newer

## Install

`npm install serverless-step-functions-local -D`

## Getting Started

You'll need to add this plugin to your `serverless.yml`.  The plugins section should look something like this when you're done:

```yaml
plugins:
  ...
  - serverless-step-functions
  - serverless-step-functions-local
  - serverless-offline-lambda
  - serverless-offline
  ...
```

Then, add a new section to `config` with `accountId` and `region` parameters:

```yaml
custom:
  stepFunctionsLocal:
    accountId: 101010101010
    region: us-east-1
```

Although not neccessary, it's strongly recomended to add the folder with the downloaded step function executables to `.gitignore`.  By default, this path is `./.step-functions-local`.

The plugin binds to port 8083, this cannot be changed.

It also adds an environment variable for each created state machine that contains the ARN for it.  These variables are prefixed by `OFFLINE_STEP_FUNCTIONS_ARN_`, so the ARN of a state machine named 'WaitMachine', for example could be fetched by reading `OFFLINE_STEP_FUNCTIONS_ARN_WaitMachine`.

## Options

(These go under `custom.stepFunctionsLocal`.)

- `accountId` (required) your AWS account ID
- `region` (required) your AWS region
- `lambdaEndpoint` (defaults to `http://localhost:4000`) the endpoint for the lambda service
- `path` (defaults to `./.step-functions-local`) the path to store the downloaded step function executables
- `TaskResourceMapping` allows for Resource ARNs to be configured differently for local development
- `eventBridgeEvents` allows sending [EventBridge events](https://docs.aws.amazon.com/step-functions/latest/dg/cw-events.html) on execution status changes
  - `enabled` (bool) enabled or disable this feature. Disabled by default.
  - `endpoint` Endpoint for sending events to eg. for [serverless-offline-aws-eventbridge](https://github.com/rubenkaiser/serverless-offline-eventBridge) would be `http://localhost:4010`
- `externalInstance` allows to set a flag to use external instance of local step functions. Disabled by default.
- `stepFunctionsEndpoint` (defaults to `http://localhost:8083`) the endpoint for the step functions service
### Full Config Example

```yaml
service: local-step-function

plugins:
  - serverless-step-functions
  - serverless-step-functions-local
  - serverless-offline-lambda
  - serverless-offline

provider:
  name: aws
  runtime: nodejs10.x


custom:
  stepFunctionsLocal:
    accountId: 101010101010
    region: us-east-1
    TaskResourceMapping:
      FirstState: arn:aws:lambda:us-east-1:101010101010:function:hello
      FinalState: arn:aws:lambda:us-east-1:101010101010:function:hello
    eventBridgeEvents:
      enabled: true
      endpoint: http://localhost:4010
  sqsUrl: http://localhost:4566/101010101010/example-queue

functions:
  hello:
    handler: handler.hello

stepFunctions:
  stateMachines:
    WaitMachine:
      definition:
        Comment: "An example of the Amazon States Language using wait states"
        StartAt: FirstState
        States:
          FirstState:
            Type: Task
            Resource: Fn::GetAtt: [hello, Arn]
            Next: send_message
          send_message:
            Type: Task
            Resource: arn:aws:states:::sqs:sendMessage
            Parameters:
              QueueUrl: ${self:custom.sqsUrl}
              "MessageBody.$": "$"
            Next: wait_using_seconds
          wait_using_seconds:
            Type: Wait
            Seconds: 10
            Next: FinalState
          FinalState:
            Type: Task
            Resource: Fn::GetAtt: [hello, Arn]
            End: true
```
## Running external instance

To run external step functions local using docker, use this command:

```
docker run \
    -p 8083:8083 \
    -e "AWS_ACCOUNT_ID=101010101010" \
    -e "AWS_DEFAULT_REGION=us-east-1" \
    -e "LAMBDA_ENDPOINT=http://localhost:4000" \
    amazon/aws-stepfunctions-local
```