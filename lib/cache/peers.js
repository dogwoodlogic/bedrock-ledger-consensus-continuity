/*!
 * Copyright (c) 2017-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const cache = require('bedrock-redis');
const _cacheKey = require('./cache-key');

exports.getManual = async ({ledgerNodeId}) => {
  const key = _cacheKey.peerListManual(ledgerNodeId);
  return cache.client.smembers(key);
};
