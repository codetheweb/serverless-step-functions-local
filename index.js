const path = require('path');
const StepFunctionsLocal = require('stepfunctions-localhost');
const AWS = require('aws-sdk');
const tcpPortUsed = require('tcp-port-used');

class ServerlessStepFunctionsLocal {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.service = serverless.service;
    this.options = options;

    this.log = serverless.cli.log.bind(serverless.cli);
    this.config = (this.service.custom && this.service.custom.stepFunctionsLocal) || {};

    // Check config
    if (!this.config.accountId) {
      throw new Error('Step Functions Local: missing accountId');
    }

    if (!this.config.region) {
      throw new Error('Step Functions Local: missing region');
    }

    if (!this.config.lambdaEndpoint) {
      this.config.lambdaEndpoint = 'http://localhost:4000';
    }

    if (!this.config.path) {
      this.config.path = './.step-functions-local';
    }

    this.stepfunctionsServer = new StepFunctionsLocal(this.config);

    this.stepfunctionsAPI = new AWS.StepFunctions({endpoint: 'http://localhost:8083', region: this.config.region});

    this.hooks = {
      'offline:start:init': async () => {
        await this.installStepFunctions();
        await this.startStepFunctions();
        await this.getStepFunctionsFromConfig();
        await this.createEndpoints();
      },
      'before:offline:start:end': async () => {
        await this.stopStepFunctions();
      }
    };
  }

  installStepFunctions() {
    return this.stepfunctionsServer.install();
  }

  async startStepFunctions() {
    this.stepfunctionsServer.start({
      account: this.config.accountId.toString(),
      lambdaEndpoint: this.config.lambdaEndpoint
    });

    // Wait for server to start
    await tcpPortUsed.waitUntilUsed(8083, 200, 10000);
  }

  stopStepFunctions() {
    return this.stepfunctionsServer.stop();
  }

  async getStepFunctionsFromConfig() {
    const {servicePath} = this.serverless.config;

    if (!servicePath) {
      throw new Error('service path not found');
    }

    const configPath = path.join(servicePath, 'serverless.yml');

    const parsed = await this.serverless.yamlParser.parse(configPath);

    this.stateMachines = parsed.stepFunctions.stateMachines;
  }

  createEndpoints() {
    return Promise.all(Object.keys(this.stateMachines).map(stateMachineName => this.stepfunctionsAPI.createStateMachine({
      definition: JSON.stringify(this.stateMachines[stateMachineName].definition),
      name: stateMachineName,
      roleArn: `arn:aws:iam::${this.config.accountId}:role/DummyRole`
    }).promise()
    ));
  }
}

module.exports = ServerlessStepFunctionsLocal;
