/*!
 * Copyright (c) 2017-2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const axios = require('axios');
const brHttpsAgent = require('bedrock-https-agent');
const {httpClient} = require('@digitalbazaar/http-client');
const {config, util: {BedrockError}} = require('bedrock');

// TODO: document; returns a stream
exports.getEvents = async ({eventHash, peerId}) => {
  const url = peerId + '/events-query';
  const data = {eventHash};
  const {'ledger-consensus-continuity': {client: {timeout}}} = config;
  const {httpsAgent} = brHttpsAgent;
  const response = await httpClient.post(url, {
    agent: httpsAgent,
    json: data,
    timeout
  });
  if(!response.ok) {
    throw new Error(`Error retrieving events from peer: "${peerId}"`);
  }
  return response.body;
};

exports.getHistory = async ({callerId, creatorHeads, headsOnly, peerId}) => {
  if(!callerId) {
    throw new TypeError('"callerId" is required.');
  }
  const url = `${peerId}/gossip`;
  // the peerId sent to the peer node is the peerId of the local node
  const data = {peerId: callerId};
  if(creatorHeads) {
    data.creatorHeads = creatorHeads;
  }
  if(headsOnly) {
    data.headsOnly = true;
  }
  const {'ledger-consensus-continuity': {client: {timeout}}} = config;
  const {httpsAgent} = brHttpsAgent;
  let res;
  try {
    res = await axios({
      httpsAgent,
      method: 'POST',
      url,
      data,
      timeout,
    });
  } catch(error) {
    const {cause, httpStatusCode} = _processAxiosError(error);
    throw new BedrockError(
      'Could not get peer history.', 'NetworkError',
      {callerId, httpStatusCode, peerId}, cause);
  }
  if(!res.data) {
    throw new BedrockError(
      'Could not get peer history. Response body was empty.', 'NetworkError', {
        creatorHeads,
        headsOnly,
        httpStatusCode: res.status,
        peerId,
        public: true,
      });
  }
  // FIXME: validate body `{creatorHeads, history, truncated}`?
  return res.data;
};

exports.notifyPeer = async ({callerId, peerId}) => {
  const url = `${peerId}/notify`;
  const {'ledger-consensus-continuity': {client: {timeout}}} = config;
  const {httpsAgent} = brHttpsAgent;
  try {
    await axios({
      httpsAgent,
      method: 'POST',
      url,
      // the peerId sent to the peer node is the peerId of the local node
      data: {peerId: callerId},
      timeout,
    });
  } catch(error) {
    const {cause, httpStatusCode} = _processAxiosError(error);
    throw new BedrockError(
      'Could not send peer notification.', 'NetworkError',
      {callerId, httpStatusCode, peerId}, cause);
  }
};

function _processAxiosError(error) {
  const {request, response} = error;
  let cause;
  let httpStatusCode;
  if(response && response.data && response.data.details) {
    // it's BedrockError
    httpStatusCode = response.status;
    cause = new BedrockError(
      response.data.message, response.data.type, response.data.details);
  } else if(response) {
    httpStatusCode = response.status;
    cause = new BedrockError('An HTTP error occurrred.', 'NetworkError', {
      data: response.data,
      httpStatusCode,
    });
  } else if(request) {
    // no status code available
    const {address, code, errno, port} = error;
    cause = new BedrockError(error.message, 'NetworkError', {
      address, code, errno, port
    });
  } else {
    // no status code available
    cause = new BedrockError(error.message, 'NetworkError');
  }
  return {cause, httpStatusCode};
}
