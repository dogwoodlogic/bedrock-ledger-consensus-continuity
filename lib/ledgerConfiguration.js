/*!
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const config = bedrock.config;
const events = require('./events');

const api = {};
module.exports = api;

/**
 * Adds a new event.
 *
 * @param event the event to add.
 * @param ledgerNode the node that is tracking this event.
 * @param options the options to use.
 * @param callback(err, record) called once the operation completes.
 */
api.change = (ledgerConfiguration, ledgerNode, options, callback) => {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  const event = {
    '@context': config.constants.WEB_LEDGER_CONTEXT_V1_URL,
    type: 'WebLedgerConfigurationEvent',
    ledgerConfiguration
  };
  events.add(event, ledgerNode, options, err => callback(err));
};