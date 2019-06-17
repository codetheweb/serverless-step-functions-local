# serverless-step-functions-local
Run AWS step functions offline with Serverless!

This is a plugin for the [Serverless Framework](https://serverless.com/).  It uses [stepfunctions-localhost](https://www.npmjs.com/package/stepfunctions-localhost) to emulate step functions with AWS' provided tool for local development.

## Requirements

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

## Options

(These go under `custom.stepFunctionsLocal`.)

- `accountId` (required) your AWS account ID
- `region` (required) your AWS region
- `lambdaEndpoint` (defaults to `http://localhost:4000`) the endpoint for the lambda service
- `path` (defaults to `./.step-functions-local`) the path to store the downloaded step function executables

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
            Resource: arn:aws:lambda:us-east-1:101010101010:function:hello
            Next: wait_using_seconds
          wait_using_seconds:
            Type: Wait
            Seconds: 10
            Next: FinalState
          FinalState:
            Type: Task
            Resource: arn:aws:lambda:us-east-1:101010101010:function:hello
            End: true
```
