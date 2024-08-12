const StepFunctionsLocal = require('stepfunctions-localhost');
const AWS = require('aws-sdk');
const tcpPortUsed = require('tcp-port-used');
const chalk = require('chalk');
const readLine = require('readline');

class ServerlessStepFunctionsLocal {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.service = serverless.service;

    this.log = serverless.cli.log.bind(serverless.cli);
    this.config = (this.service.custom && this.service.custom.stepFunctionsLocal) || {};
    this.serverlessOfflineConfig = (this.service.custom && 'serverless-offline' in this.service.custom ) ? this.service.custom['serverless-offline'] : {}
    this.usedEndpointFromServerlessOffline = false;

    // Check config
    if (!this.config.accountId) {
      throw new Error('Step Functions Local: missing accountId');
    }

    if (!this.config.region) {
      throw new Error('Step Functions Local: missing region');
    }

    if (!this.config.lambdaEndpoint) {
      if (this.serverlessOfflineConfig) {
        let port = 3000; // default serverless offline port
        let httpProtocol = 'http'; // default serverless offline protocol
        let host = 'localhost'; // default serverless offline host

        if ('httpPort' in this.serverlessOfflineConfig) {
          port = this.serverlessOfflineConfig['httpPort'];
        }

        if ('host' in this.serverlessOfflineConfig) {
          host = this.serverlessOfflineConfig['host']
        }

        if ('httpsProtocol' in this.serverlessOfflineConfig) {
          httpProtocol = 'https'
        }

        this.config.lambdaEndpoint = `${httpProtocol}://${host}:${port}`;
        this.usedEndpointFromServerlessOffline = true;
      } else {
        this.config.lambdaEndpoint = 'http://localhost:4000';
      }
    }

    if (!this.config.path) {
      this.config.path = './.step-functions-local';
    }

    if (!this.config.stepFunctionsEndpoint) {
      this.config.stepFunctionsEndpoint = 'http://localhost:8083';
    }

    if (!this.config.externalInstance) {
      this.config.externalInstance = false;
    }

    this.stepfunctionsServer = new StepFunctionsLocal(this.config);

    this.stepfunctionsAPI = new AWS.StepFunctions({ endpoint: this.config.stepFunctionsEndpoint, region: this.config.region });

    this.eventBridgeEventsEnabled = this.config.eventBridgeEvents && this.config.eventBridgeEvents.enabled;
    if (this.eventBridgeEventsEnabled) {
      this.eventBridgeAPI = new AWS.EventBridge({ endpoint: this.config.eventBridgeEvents.endpoint, region: this.config.region });
    }

    this.hooks = {
      'offline:start:init': async () => {

        if (!this.config.externalInstance) {
          await this.installStepFunctions();
          await this.startStepFunctions();
        }

        await this.getStepFunctionsFromConfig();
        await this.createEndpoints();
      },
      'before:offline:start:end': async () => {
        if (!this.config.externalInstance) {
          await this.stopStepFunctions();
        }
      }
    };
  }

  installStepFunctions() {
    return this.stepfunctionsServer.install();
  }

  async startStepFunctions() {
    let serverStdout = this.stepfunctionsServer.start({
      account: this.config.accountId.toString(),
      lambdaEndpoint: this.config.lambdaEndpoint,
      region: this.config.region,
      waitTimeScale: this.config.waitTimeScale,
      stepFunctionsEndpoint: this.config.stepFunctionsEndpoint,
    });

    if (this.usedEndpointFromServerlessOffline) {
      console.log(chalk.yellow('[Serverless Step Functions Local] Found Serverless-Offline configuration. Setting lambdaEndpoint to: ', this.config.lambdaEndpoint));
    }

    readLine.createInterface({ input: serverStdout }).on('line', line => {
      console.log(chalk.blue('[Serverless Step Functions Local]'), line.trim());

      if (this.eventBridgeEventsEnabled) {
        this.sendEventBridgeEvent(line.trim());
      }
    });

    // Wait for server to start
    await tcpPortUsed.waitUntilUsed(8083, 200, 10000);
  }

  stopStepFunctions() {
    return this.stepfunctionsServer.stop();
  }

  async getStepFunctionsFromConfig() {
    const parsed = this.serverless.configurationInput;
    this.stateMachines = parsed.stepFunctions.stateMachines;

    if (parsed.custom &&
      parsed.custom.stepFunctionsLocal &&
      parsed.custom.stepFunctionsLocal.TaskResourceMapping
    ) {
      this.replaceTaskResourceMappings(
        parsed.stepFunctions.stateMachines,
        parsed.custom.stepFunctionsLocal.TaskResourceMapping
      );
    }
  }

/**
   * Replaces Resource properties with values mapped in TaskResourceMapping
   */
 replaceTaskResourceMappings(input, replacements, parentKey) {
  for (const key in input) {
    if ({}.hasOwnProperty.call(input, key)) {
      const property = input[key];
      if (['object', 'array'].indexOf(typeof property) > -1) {
        if (input.Resource && replacements[parentKey]) {
          if (typeof input.Resource === 'string' && input.Resource.indexOf('.waitForTaskToken') > -1) {
            input.Parameters.FunctionName = replacements[parentKey];
          } else {
            input.Resource = replacements[parentKey];
          }
        }
        // Add support for StepFunction
        if (input.Parameters && input.Parameters.StateMachineArn && input.Parameters.StateMachineArn['Fn::GetAtt'])  {
          input.Parameters.StateMachineArn = replacements[input.Parameters.StateMachineArn['Fn::GetAtt'][0]]
        }

        // Recursive replacement of nested states
        this.replaceTaskResourceMappings(property, replacements, key);
      }
    }
  }
}

  async createEndpoints() {
    for (const stateMachineName in this.stateMachines) {
      const endpoint = await this.stepfunctionsAPI.createStateMachine({
        definition: JSON.stringify(this.stateMachines[stateMachineName].definition),
        type: this.stateMachines[stateMachineName].type || "STANDARD",
        name: this.stateMachines[stateMachineName].name || stateMachineName,
        roleArn: `arn:aws:iam::${this.config.accountId}:role/DummyRole`
      }).promise();

      // Set environment variables with references to ARNs
      process.env[`OFFLINE_STEP_FUNCTIONS_ARN_${endpoint.stateMachineArn.split(':')[6]}`] = endpoint.stateMachineArn;
    }
  }

  sendEventBridgeEvent(logLine) {
    let pattern = /(?<date>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}.\d{3}): (?<executionArn>.+) : (?<data>.+)/;
    let match = pattern.exec(logLine);

    if (match !== null) {
      let eventDate = Date.parse(match.groups.date);

      // Eg. arn:aws:states:us-east-1:101010101010:execution:state-machine-id:execution-id
      let eventExecutionArn = match.groups.executionArn;
      let eventExecutionName = eventExecutionArn.split(':').pop();
      let eventStatemachineArn = eventExecutionArn.replace(':execution:', ':stateMachine:').split(':').slice(0, -1).join(':');

      let eventData = JSON.parse(match.groups.data);

      let eventStatus;
      let eventStartDate = null;
      let eventStopDate = null;

      // https://docs.aws.amazon.com/step-functions/latest/dg/cw-events.html
      // https://docs.aws.amazon.com/step-functions/latest/apireference/API_HistoryEvent.html
      switch (eventData.Type) {
        case 'ExecutionAborted':
          eventStatus = "ABORTED";
          eventStopDate = eventDate;
          break;
        case 'ExecutionFailed':
          eventStatus = "FAILED";
          eventStopDate = eventDate;
          break;
        case 'ExecutionStarted':
          eventStatus = "RUNNING";
          eventStartDate = eventDate;
          break;
        case 'ExecutionSucceeded':
          eventStatus = "SUCCEEDED";
          eventStopDate = eventDate;
          break;
        case 'ExecutionTimedOut':
          eventStatus = "TIMED_OUT";
          eventStopDate = eventDate;
          break;
      }

      if (eventStatus !== undefined) {
        let params = {
          Entries: [
            {
              Detail: JSON.stringify({
                executionArn: eventExecutionArn,
                stateMachineArn: eventStatemachineArn,
                name: eventExecutionName,
                status: eventStatus,
                startDate: eventStartDate,
                stopDate: eventStopDate
              }),
              DetailType: 'Step Functions Execution Status Change',
              Resources: [eventExecutionArn],
              Source: 'aws.states',
              Time: eventDate
            }
          ]
        };

        this.eventBridgeAPI.putEvents(params, function(err, data) {
          if (err) {
            console.error(chalk.bgRed('[Serverless Step Functions Local]'), err, err.stack);
          }
        });
      }
    }
  }
}

module.exports = ServerlessStepFunctionsLocal;
