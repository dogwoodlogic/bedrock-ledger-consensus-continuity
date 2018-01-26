/*
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
const workerpool = require('workerpool');
const consensus = require('./consensus');

workerpool.worker({
  findConsensus: (
    {ledgerNodeId, history, blockHeight, electors, logger}) => {
    // rebuild events map so that linking history will work properly; i.e.
    // when events were marshalled/unmarshalled different instances were
    // created in `history.eventMap` vs `history.events`
    history.eventMap = {};
    for(const e of history.events) {
      history.eventMap[e.eventHash] = e;
    }
    return consensus.findConsensus(
      {ledgerNodeId, history, blockHeight, electors, logger});
  }
});