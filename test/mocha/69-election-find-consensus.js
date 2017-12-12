/*
 * Copyright (c) 2017 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const _ = require('lodash');
const bedrock = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const async = require('async');
const uuid = require('uuid/v4');
const util = require('util');

const helpers = require('./helpers');
const mockData = require('./mock.data');

let consensusApi;

describe.only('Election API findConsensus', () => {
  before(done => {
    helpers.prepareDatabase(mockData, done);
  });
  let genesisMerge;
  let eventHash;
  let testEventId;
  const nodes = {};
  const peers = {};
  beforeEach(done => {
    const configEvent = mockData.events.config;
    const testEvent = bedrock.util.clone(mockData.events.alpha);
    testEventId = 'https://example.com/events/' + uuid();
    testEvent.input[0].id = testEventId;
    async.auto({
      clean: callback =>
        helpers.removeCollections(['ledger', 'ledgerNode'], callback),
      consensusPlugin: callback =>
        brLedgerNode.use('Continuity2017', (err, result) => {
          if(err) {
            return callback(err);
          }
          consensusApi = result.api;
          callback();
        }),
      ledgerNode: ['clean', (results, callback) => brLedgerNode.add(
        null, {configEvent}, (err, result) => {
          if(err) {
            return callback(err);
          }
          nodes.alpha = result;
          callback(null, result);
        })],
      genesisMerge: ['consensusPlugin', 'ledgerNode', (results, callback) => {
        consensusApi._worker._events._getLocalBranchHead({
          eventsCollection: nodes.alpha.storage.events.collection
        }, (err, result) => {
          if(err) {
            return callback(err);
          }
          genesisMerge = result;
          callback();
        });
      }],
      genesisBlock: ['ledgerNode', (results, callback) =>
        nodes.alpha.blocks.getGenesis((err, result) => {
          if(err) {
            return callback(err);
          }
          callback(null, result.genesisBlock.block);
        })],
      nodeBeta: ['genesisBlock', (results, callback) => brLedgerNode.add(
        null, {genesisBlock: results.genesisBlock}, (err, result) => {
          if(err) {
            return callback(err);
          }
          nodes.beta = result;
          callback(null, result);
        })],
      nodeGamma: ['genesisBlock', (results, callback) => brLedgerNode.add(
        null, {genesisBlock: results.genesisBlock}, (err, result) => {
          if(err) {
            return callback(err);
          }
          nodes.gamma = result;
          callback(null, result);
        })],
      nodeDelta: ['genesisBlock', (results, callback) => brLedgerNode.add(
        null, {genesisBlock: results.genesisBlock}, (err, result) => {
          if(err) {
            return callback(err);
          }
          nodes.delta = result;
          callback(null, result);
        })],
      // NOTE: if nodeEpsilon is enabled, be sure to add to `creator` deps
      // nodeEpsilon: ['genesisBlock', (results, callback) => brLedgerNode.add(
      //   null, {genesisBlock: results.genesisBlock}, (err, result) => {
      //     if(err) {
      //       return callback(err);
      //     }
      //     nodes.epsilon = result;
      //     callback(null, result);
      //   })],
      creator: ['nodeBeta', 'nodeGamma', 'nodeDelta', (results, callback) =>
        async.eachOf(nodes, (n, i, callback) =>
          consensusApi._worker._voters.get(n.id, (err, result) => {
            if(err) {
              return callback(err);
            }
            peers[i] = result.id;
            callback();
          }), callback)]
    }, done);
  });
  it('Test 1', done => {
    // the genesisMerge already has consensus
    const findConsensus = consensusApi._worker._election.findConsensus;
    const getRecentHistory = consensusApi._worker._events.getRecentHistory;
    const ledgerNode = nodes.alpha;
    const electors = [peers.alpha];
    const eventTemplate = mockData.events.alpha;
    async.auto({
      event1: callback => helpers.addEventAndMerge(
        {consensusApi, eventTemplate, ledgerNode}, callback),
      history: ['event1', (results, callback) => getRecentHistory(
        {ledgerNode}, callback)],
      consensus: ['history', (results, callback) => {
        findConsensus(
          {electors, ledgerNode, history: results.history}, (err, result) => {
            assertNoError(err);
            console.log('777777777', result);
            // should.not.exist(result);
            callback();
          });
      }]
    }, done);
  });
  it.skip('Test 2', done => {
    const findConsensus = consensusApi._worker._election.findConsensus;
    const getRecentHistory = consensusApi._worker._events.getRecentHistory;
    const ledgerNode = nodes.alpha;
    const electors = [peers.alpha];
    const eventTemplate = mockData.events.alpha;
    async.auto({
      event1: callback => helpers.addEventAndMerge(
        {consensusApi, eventTemplate, ledgerNode}, callback),
      history: ['event1', (results, callback) => getRecentHistory(
        {ledgerNode}, callback)],
      consensus: ['history', (results, callback) => {
        findConsensus(
          {electors, ledgerNode, history: results.history}, (err, result) => {
            assertNoError(err);
            should.not.exist(result);
            callback();
          });
      }]
    }, done);
  });
  it('ledger history alpha', done => {
    const findConsensus = consensusApi._worker._election.findConsensus;
    const getRecentHistory = consensusApi._worker._events.getRecentHistory;
    const ledgerNode = nodes.alpha;
    const electors = _.values(peers);
    async.auto({
      build: callback => helpers.buildHistory(
        {consensusApi, historyId: 'alpha', mockData, nodes}, callback),
      history: ['build', (results, callback) => getRecentHistory(
        {ledgerNode}, callback)],
      consensus: ['history', (results, callback) => {
        findConsensus(
          {electors, ledgerNode, history: results.history}, (err, result) => {
            const {copyMergeHashes, copyMergeHashesIndex, regularEvent} =
              results.build;
            assertNoError(err);
            should.exist(result);
            should.exist(result.event);
            result.event.should.be.an('array');
            result.event.should.have.length(16);
            should.exist(result.eventHash);
            result.eventHash.should.be.an('array');
            result.eventHash.should.have.length(16);
            result.eventHash.should.have.same.members([
              ...regularEvent.regularHash,
              ...regularEvent.mergeHash,
              copyMergeHashes.cpa,
              copyMergeHashes.cpb,
              copyMergeHashes.cp1,
              copyMergeHashes.cp2,
              copyMergeHashes.cp3,
              copyMergeHashes.cp4,
              copyMergeHashes.cp5,
              copyMergeHashes.cp6,
            ]);
            should.exist(result.consensusProof);
            result.consensusProof.should.be.an('array');
            result.consensusProof.should.have.length(8);
            should.exist(result.consensusProofHash);
            result.consensusProofHash.should.be.an('array');
            result.consensusProofHash.should.have.length(8);
            result.consensusProofHash.should.have.same.members([
              copyMergeHashes.cp7,
              copyMergeHashes.cp8,
              copyMergeHashes.cp9,
              copyMergeHashes.cp10,
              copyMergeHashes.cp11,
              copyMergeHashes.cp12,
              copyMergeHashes.cp13,
              copyMergeHashes.cp14
            ]);
            proofReport({
              copyMergeHashes,
              copyMergeHashesIndex,
              consensusProofHash: result.consensusProofHash,
            });
            callback();
          });
      }]
    }, done);
  });
  it('ledger history beta', done => {
    const findConsensus = consensusApi._worker._election.findConsensus;
    const getRecentHistory = consensusApi._worker._events.getRecentHistory;
    const ledgerNode = nodes.alpha;
    const electors = _.values(peers);
    async.auto({
      build: callback => helpers.buildHistory(
        {consensusApi, historyId: 'beta', mockData, nodes}, callback),
      history: ['build', (results, callback) => getRecentHistory(
        {ledgerNode}, callback)],
      consensus: ['history', (results, callback) => {
        findConsensus(
          {electors, ledgerNode, history: results.history}, (err, result) => {
            const {copyMergeHashes, copyMergeHashesIndex, regularEvent} =
              results.build;
            assertNoError(err);
            result.event.should.have.length(15);
            result.eventHash.should.have.length(15);
            result.eventHash.should.have.same.members([
              ...regularEvent.regularHash,
              ...regularEvent.mergeHash,
              copyMergeHashes.cpa,
              copyMergeHashes.cpb,
              copyMergeHashes.cp1,
              copyMergeHashes.cp2,
              copyMergeHashes.cp3,
              copyMergeHashes.cp4,
              copyMergeHashes.cp6,
            ]);
            result.consensusProof.should.have.length(5);
            result.consensusProofHash.should.have.length(5);
            result.consensusProofHash.should.have.same.members([
              copyMergeHashes.cp7,
              copyMergeHashes.cp9,
              copyMergeHashes.cp11,
              copyMergeHashes.cp12,
              copyMergeHashes.cp14
            ]);
            // proofReport({
            //   copyMergeHashes,
            //   copyMergeHashesIndex,
            //   consensusProofHash: result.consensusProofHash,
            // });
            callback();
          });
      }]
    }, done);
  });
  it('ledger history gamma', done => {
    const findConsensus = consensusApi._worker._election.findConsensus;
    const getRecentHistory = consensusApi._worker._events.getRecentHistory;
    const ledgerNode = nodes.alpha;
    const electors = _.values(peers);
    async.auto({
      build: callback => helpers.buildHistory(
        {consensusApi, historyId: 'gamma', mockData, nodes}, callback),
      history: ['build', (results, callback) => getRecentHistory(
        {ledgerNode}, callback)],
      consensus: ['history', (results, callback) => {
        findConsensus(
          {electors, ledgerNode, history: results.history}, (err, result) => {
            const {copyMergeHashes, copyMergeHashesIndex, regularEvent} =
              results.build;
            assertNoError(err);
            result.event.should.have.length(16);
            result.eventHash.should.have.length(16);
            result.eventHash.should.have.same.members([
              ...regularEvent.regularHash,
              ...regularEvent.mergeHash,
              copyMergeHashes.cpa,
              copyMergeHashes.cpb,
              copyMergeHashes.cp1,
              copyMergeHashes.cp2,
              copyMergeHashes.cp3,
              copyMergeHashes.cp4,
              copyMergeHashes.cp5,
              copyMergeHashes.cp6
            ]);
            result.consensusProof.should.have.length(4);
            result.consensusProofHash.should.have.length(4);
            result.consensusProofHash.should.have.same.members([
              copyMergeHashes.cp7,
              copyMergeHashes.cp8,
              copyMergeHashes.cp9,
              copyMergeHashes.cp10
            ]);
            // proofReport({
            //   copyMergeHashes,
            //   copyMergeHashesIndex,
            //   consensusProofHash: result.consensusProofHash,
            // });
            callback();
          });
      }]
    }, done);
  });
});

function proofReport(
  {copyMergeHashes, copyMergeHashesIndex, consensusProofHash}) {
  console.log(
    'REPORTED PROOF',
    consensusProofHash.map(c => copyMergeHashesIndex[c]));
}