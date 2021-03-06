/*!
 * Copyright (c) 2017-2020 Digital Bazaar, Inc. All rights reserved.
 */
module.exports = async function historyEpsilon(
  {api, consensusApi, eventTemplate, nodes, opTemplate} = {}) {
  const results = {};

  // add a regular event and merge on every node
  results.regularEvent = await api.addEventMultiNode(
    {consensusApi, eventTemplate, nodes, opTemplate});

  [results.cpa, results.cbp] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'beta', nodes, to: 'alpha'}),
    api.copyAndMerge({consensusApi, from: 'gamma', nodes, to: 'delta'})
  ]);
  [results.cp1, results.cp2] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'alpha', nodes, to: 'beta'}),
    api.copyAndMerge({consensusApi, from: 'delta', nodes, to: 'gamma'})
  ]);

  // snapshot gamma before copy
  results.ss2 = await api.snapshotEvents({ledgerNode: nodes.gamma});
  [results.cp3, results.cp4] = await Promise.all([
    api.copyAndMerge(
      {consensusApi, from: ['beta', 'delta'], nodes, to: 'gamma'}),
    api.copyAndMerge({
      consensusApi, from: ['alpha', 'gamma'], nodes, to: 'beta',
      useSnapshot: true
    })
  ]);

  // snapshot gamma before copy
  results.ss3 = await api.snapshotEvents({ledgerNode: nodes.gamma});
  [results.cp5, results.cp6] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'beta', nodes, to: 'gamma'}),
    api.copyAndMerge(
      {consensusApi, from: 'gamma', nodes, to: 'beta', useSnapshot: true})
  ]);
  [results.cp7, results.cp8] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'beta', nodes, to: 'alpha'}),
    api.copyAndMerge({consensusApi, from: 'gamma', nodes, to: 'delta'})
  ]);
  [results.cp9, results.cp10] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'alpha', nodes, to: 'beta'}),
    api.copyAndMerge({consensusApi, from: 'delta', nodes, to: 'gamma'})
  ]);

  // snapshot gamma before copy
  results.ss10 = await api.snapshotEvents({ledgerNode: nodes.gamma});
  [results.cp11, results.cp12] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'beta', nodes, to: 'gamma'}),
    api.copyAndMerge(
      {consensusApi, from: 'gamma', nodes, to: 'beta', useSnapshot: true})
  ]);

  // snapshot gamma before copy
  results.ss11 = await api.snapshotEvents({ledgerNode: nodes.gamma});
  // snapshot beta before copy
  results.ss12 = await api.snapshotEvents({ledgerNode: nodes.beta});
  [results.cp13, results.cp14] = await Promise.all([
    api.copyAndMerge({
      consensusApi, from: ['beta', 'gamma'], nodes, to: 'alpha',
      useSnapshot: true
    }),
    api.copyAndMerge({
      consensusApi, from: ['beta', 'gamma'], nodes, to: 'delta',
      useSnapshot: true
    })
  ]);
  [results.cp15, results.cp16] = await Promise.all([
    api.copyAndMerge(
      {consensusApi, from: ['alpha', 'gamma'], nodes, to: 'beta'}),
    api.copyAndMerge(
      {consensusApi, from: ['beta', 'delta'], nodes, to: 'gamma'})
  ]);
  [results.cp17, results.cp18] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'gamma', nodes, to: 'beta'}),
    api.copyAndMerge({consensusApi, from: 'beta', nodes, to: 'gamma'})
  ]);

  // snapshot beta before copy
  results.ss17 = await api.snapshotEvents({ledgerNode: nodes.beta});
  // snapshot gamma before copy
  results.ss18 = await api.snapshotEvents({ledgerNode: nodes.gamma});
  [results.cp19, results.cp20] = await Promise.all([
    api.copyAndMerge(
      {consensusApi, from: ['beta', 'gamma'], nodes, to: 'alpha'}),
    api.copyAndMerge(
      {consensusApi, from: ['beta', 'gamma'], nodes, to: 'delta'})
  ]);

  // snapshot alpha before copy
  results.ss19 = await api.snapshotEvents({ledgerNode: nodes.alpha});
  // snapshot delta before copy
  results.ss20 = await api.snapshotEvents({ledgerNode: nodes.delta});
  [results.cp21, results.cp22] = await Promise.all([
    api.copyAndMerge({
      consensusApi, from: ['alpha', 'delta'], nodes, to: 'beta',
      useSnapshot: true
    }),
    api.copyAndMerge({
      consensusApi, from: ['alpha', 'delta'], nodes, to: 'gamma',
      useSnapshot: true})
  ]);
  [results.cp23, results.cp24] = await Promise.all([
    api.copyAndMerge({consensusApi, from: 'beta', nodes, to: 'alpha'}),
    api.copyAndMerge({consensusApi, from: 'gamma', nodes, to: 'delta'})
  ]);

  return results;
};
