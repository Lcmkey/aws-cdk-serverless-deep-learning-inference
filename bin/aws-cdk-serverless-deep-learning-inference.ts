#!/usr/bin/env node
require("dotenv").config();

import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';

import { LambdaEFSMLStack } from '../lib/aws-cdk-serverless-deep-learning-inference-stack';


/**
 * Get variables from Env
 */
const {
    PREFIX: prefix = "[STACK PREFIX NAME]",
    STAGE: stage = "[DEPLOYMENT STAGE]",
    CDK_ACCOUNT: accountId = "[AWS ACCOUNT ID]",
    CDK_REGION: region = "ap-southeast-1",
} = process.env;

/**
 * AWS defulat ENV config Definition
 */
const env = {
    account: accountId,
    region: region,
};

const app = new cdk.App();

new LambdaEFSMLStack(app, `${prefix}-${stage}-LambdaEFSMLStack`, {
    env,
    prefix,
    stage,
    installPackages: undefined,

});

app.synth();