/*
 * Copyright (c) 2017 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const config = bedrock.config;
const constants = config.constants;
const helpers = require('./helpers');

const mock = {};
module.exports = mock;

const identities = mock.identities = {};

// identity with permission to access its own agreements
const userName = 'regularUser';
identities[userName] = {};
identities[userName].identity = helpers.createIdentity(userName);
identities[userName].identity.sysResourceRole.push({
  sysRole: 'bedrock-ledger.test',
  generateResource: 'id'
});

// // identity with no permissions
// userName = 'noPermission';
// identities[userName] = {};
// identities[userName].identity = helpers.createIdentity(userName);

const events = mock.events = {};
events.alpha = {
  '@context': constants.WEB_LEDGER_CONTEXT_V1_URL,
  type: 'WebLedgerEvent',
  operation: 'Create',
  input: [{
    '@context': constants.TEST_CONTEXT_V1_URL,
    id: 'https://example.com/events/123456',
    type: 'Concert',
    name: 'Big Band Concert in New York City',
    startDate: '2017-07-14T21:30',
    location: 'https://example.org/the-venue',
    offers: {
      type: 'Offer',
      price: '13.00',
      priceCurrency: 'USD',
      url: 'https://www.ticketfly.com/purchase/309433'
    }
  }]
};

events.config = {
  '@context': constants.WEB_LEDGER_CONTEXT_V1_URL,
  type: 'WebLedgerConfigurationEvent',
  ledgerConfiguration: {
    type: 'WebLedgerConfiguration',
    ledger: 'did:v1:eb8c22dc-bde6-4315-92e2-59bd3f3c7d59',
    consensusMethod: 'Continuity2017'
  }
};

const mergeEvents = mock.mergeEvents = {};
mergeEvents.alpha = {
  '@context': constants.WEB_LEDGER_CONTEXT_V1_URL,
  'type': ['WebLedgerEvent', 'ContinuityMergeEvent'],
  'treeHash': 'ni:///sha-256;1rj73NTf8Nx3fhGrwHo7elDCF7dfdUqPoK2tzpf-XXX',
  'parentHash': [
    'ni:///sha-256;1rj73NTf8Nx3fhGrwHo7elDCF7dfdUqPoK2tzpf-AAA',
    'ni:///sha-256;1rj73NTf8Nx3fhGrwHo7elDCF7dfdUqPoK2tzpf-BBB',
    'ni:///sha-256;1rj73NTf8Nx3fhGrwHo7elDCF7dfdUqPoK2tzpf-CCC'
  ]
};

// constants
mock.authorizedSignerUrl = 'https://example.com/keys/authorized-key-1';

// all mock keys for all groups
mock.groups = {
  'authorized': {
    publicKey: 'GycSSui454dpYRKiFdsQ5uaE8Gy3ac6dSMPcAoQsk8yq',
    privateKey: '3Mmk4UzTRJTEtxaKk61LxtgUxAa2Dg36jF6VogPtRiKvfpsQWKPCLesK' +
      'SV182RMmvMJKk6QErH3wgdHp8itkSSiF'
  },
  'unauthorized': { // unauthorized group
    publicKey: 'AAD3mt6xZqbJBmMp643irCG7yqCQwVUk4UUK4XGm6ZpW',
    privateKey: '5Y57oBSw5ykt21N3cbHPVDhRPL84xjgfQXN6wnqzWNQbGp5WHhy3XieA' +
      'jzwY9J26Whg1DBv31ktgUnnYuDkWXMTQ'
  }
};

mock.exampleIdentity =
  `https://example.com/i/${mock.groups.authorized.publicKey}`;
mock.ldDocuments = {
  [mock.exampleIdentity]: {
    "@context": constants.WEB_LEDGER_CONTEXT_V1_URL,
    "id": mock.exampleIdentity,
    "publicKey": [{
      "id": mock.authorizedSignerUrl,
      "type": "CryptographicKey",
      "owner": mock.exampleIdentity,
      "publicKeyBase58": mock.groups.authorized.publicKey
    }]
  }
};
mock.ldDocuments[mock.authorizedSignerUrl] = {
  "@context": constants.WEB_LEDGER_CONTEXT_V1_URL,
  "type": "CryptographicKey",
  "owner": mock.exampleIdentity,
  "label": "Signing Key 2",
  "id": mock.authorizedSignerUrl,
  "publicKeyBase58": mock.groups.authorized.publicKey
};

const jsonld = bedrock.jsonld;
const oldLoader = jsonld.documentLoader;
jsonld.documentLoader = function(url, callback) {
  if(Object.keys(mock.ldDocuments).includes(url)) {
    return callback(null, {
      contextUrl: null,
      document: mock.ldDocuments[url],
      documentUrl: url
    });
  }
  // const regex = new RegExp(
  //   'http://authorization.dev/dids' + '/(.*?)$');
  // const didMatch = url.match(regex);
  // if(didMatch && didMatch.length === 2 && didMatch[1] in mock.didDocuments) {
  //   return callback(null, {
  //     contextUrl: null,
  //     document: mock.didDocuments[didMatch[1]],
  //     documentUrl: url
  //   });
  // }
  oldLoader(url, callback);
};

const manifests = mock.manifests = {};

manifests.sinonAlpha = {
  "id": "ni:///sha-256;pby1SuJ7_xLQTg2uOG8D-MOmPYK_OgThL1ULhgN4y1Q",
  "type": "Events",
  "blockHeight": 1,
  "item": [
    "ni:///sha-256;d8Kbp42RxDPV9HwqKm_EbeiS4BKSFCkMzOZqzYrOcZc"
  ]
};

const sinon = mock.sinon = {};

sinon['/manifests?id=' + encodeURIComponent(manifests.sinonAlpha.id)] =
  manifests.sinonAlpha;

events.sinonAlpha = bedrock.util.clone(events.alpha);
// FIXME: does this event need to be signed?
// served by sinon in 65-election.js
events.sinonAlpha.input[0].id =
  'https://example.com/events/2b9dadb8-d786-44ed-b735-1c5a6752d290';
encodeURIComponent(manifests.sinonAlpha.item[0]);
sinon['/events?id=' + encodeURIComponent(manifests.sinonAlpha.item[0])] =
  events.sinonAlpha;
