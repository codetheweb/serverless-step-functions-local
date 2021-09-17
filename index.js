const path = require('path');
const StepFunctionsLocal = require('stepfunctions-localhost');
const AWS = require('aws-sdk');
const tcpPortUsed = require('tcp-port-used');
const chalk = require('chalk');

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

    this.stepfunctionsAPI = new AWS.StepFunctions({ endpoint: 'http://localhost:8083', region: this.config.region });

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
      lambdaEndpoint: this.config.lambdaEndpoint,
      region: this.config.region
    }).on('data', data => {
      console.log(chalk.blue('[Serverless Step Functions Local]'), data.toString());
    });

    // Wait for server to start
    await tcpPortUsed.waitUntilUsed(8083, 200, 10000);
  }

  stopStepFunctions() {
    return this.stepfunctionsServer.stop();
  }

  async getStepFunctionsFromConfig() {
    const fromYamlFile = (serverlessYmlPath) =>
      this.serverless.yamlParser.parse(serverlessYmlPath);

    let parsed = {};
    let parser = null;

    if (!this.serverless.service.stepFunctions) {
      let { servicePath } = this.serverless.config;

      if (!servicePath) {
        throw new Error('service path not found');
      }
      const serviceFileName =
        this.options.config ||
        this.serverless.config.serverless.service.serviceFilename ||
        'serverless.yml';
      if (this.serverless.service.custom &&
        this.serverless.service.custom.stepFunctionsLocal &&
        this.serverless.service.custom.stepFunctionsLocal.location) {
        servicePath = this.serverless.service.custom.stepFunctionsLocal.location
      }
      const configPath = path.join(servicePath, serviceFileName);
      if (['.js', '.json', '.ts'].includes(path.extname(configPath))) {
        parser = this.loadFromRequiredFile;
      } else {
        parser = fromYamlFile;
      }
      parsed = await parser(configPath);
    } else {
      parsed = this.serverless.service;
    }

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

  // This function must be ignored since mocking the require system is more
  // dangerous than beneficial
  loadFromRequiredFile(serverlessYmlPath) {
    /* istanbul ignore next */
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const fileContents = require(serverlessYmlPath);
    /* istanbul ignore next */
    return Promise.resolve(fileContents);
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
            input.Resource = replacements[parentKey];
          }

          // Recursive replacement of nested states
          this.replaceTaskResourceMappings(property, replacements, key);
        }
      }
    }
  }

  async createEndpoints() {
    const endpoints = await Promise.all(Object.keys(this.stateMachines).map(stateMachineName => this.stepfunctionsAPI.createStateMachine({
      definition: JSON.stringify(this.stateMachines[stateMachineName].definition),
      name: stateMachineName,
      roleArn: `arn:aws:iam::${this.config.accountId}:role/DummyRole`
    }).promise()
    ));

    // Set environment variables with references to ARNs
    endpoints.forEach(endpoint => {
      process.env[`OFFLINE_STEP_FUNCTIONS_ARN_${endpoint.stateMachineArn.split(':')[6]}`] = endpoint.stateMachineArn;
    });
  }
}

module.exports = ServerlessStepFunctionsLocal;
