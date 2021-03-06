/*!
 * Copyright (c) 2017-2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
require('bedrock-https-agent');
require('bedrock-ledger-consensus-continuity-storage');
require('bedrock-ledger-context');
require('bedrock-ledger-storage-mongodb');
require('bedrock-validation');
require('bedrock-redis');

// this is in support of agents that subscribe to pub/sub messages
require('events').EventEmitter.prototype._maxListeners = 100;

// load config defaults
require('./config');

// module API
const api = {};
module.exports = api;

api.consensusMethod = 'Continuity2017';
api.storagePlugin = 'continuity-storage';

api.getPeerId = async ({ledgerNodeId}) =>
  (await api._peers.get({ledgerNodeId})).id;

// require submodules as private APIs
api._blocks = require('./blocks');
api._cache = require('./cache');
api._client = require('./client');
api._consensus = require('./consensus');
api._events = require('./events');
api._gossip = require('./gossip');
api._hasher = brLedgerNode.consensus._hasher;
api._history = require('./history');
api._peers = require('./peers');
api._peerEvents = require('./peerEvents');
api._server = require('./server');
api._witnesses = require('./witnesses');
api._worker = require('./worker/index.js');

// expose external APIs
api.config = require('./ledgerConfiguration');
api.events = {add: api._events.add};
api.operations = require('./operations');
api.scheduleWork = api._worker.scheduleWork;

// register this ledger plugin
bedrock.events.on('bedrock.start', () =>
  brLedgerNode.use('Continuity2017', {api, type: 'consensus'}));
