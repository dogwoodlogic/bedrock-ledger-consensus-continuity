const database = require('bedrock-mongodb');
const {util: {clone, delay, uuid}} = require('bedrock');
const {promisify} = require('util');

/* eslint-disable max-len, quotes, quote-props */
const mockOperation = {
  "meta": {
    "operationHash": "zQmag4JJt62iFQFT2tUX3LbXJWZRTh8w6192z8RYcQPJpUU",
    "eventHash": "zQmTo77Jf7ey69baUVsZha3FJZD8rmK6BAvQubExQsizsFu",
    "eventOrder": 0
  },
  "operation": {
    "@context": "https://w3id.org/webledger/v1",
    "type": "CreateWebLedgerRecord",
    "record": {
      "@context": "https://w3id.org/test/v1",
      "id": "https://example.com/event/e043cb2b-e324-4ad4-a848-9708754e8238",
      "type": "Concert",
      "name": "Big Band Concert in New York City",
      "startDate": "2017-07-14T21:30",
      "location": "https://example.org/the-venue",
      "offers": {
        "type": "Offer",
        "price": "13.00",
        "priceCurrency": "USD",
        "url": "https://www.ticketfly.com/purchase/309433"
      },
      "creator": "urn:uuid:616859df-6f41-41ff-8de7-f2f7515875e6"
    },
    "creator": "https://bedrock.localhost:18443/consensus/continuity2017/voters/z6MkwfEAk2NDYhzJzbrZab1LPc81wpNYzHDRDV1TdZb3smWM"
  },
  "recordId": "Nr6SjwuONz1fwn3Ltru/kCjGAHBSorMUHi0TF8+eIUc="
};

const eventCollectionName = '6664199d-616f-4764-a1eb-81fff72d68af-event';
const operationCollectionName =
  '6664199d-616f-4764-a1eb-81fff72d68af-operation';

describe.only('it just runs nodes', () => {
  it.skip('adds operations to history', async function() {
    this.timeout(0);
    await promisify(database.openCollections)([
      eventCollectionName,
      operationCollectionName,
    ]);
    const eventCollection = database.collections[eventCollectionName];
    const operationCollection = database.collections[operationCollectionName];
    const query = {
      'meta.continuity2017.type': 'r'
    };
    const results = await eventCollection.find(query, {
      _id: 0,
      'meta.eventHash': 1
    });
    for await (const r of results) {
      const {meta: {eventHash}} = r;
      console.log('event', eventHash);
      for(let i = 1; i <= 250; ++i) {
        const op = clone(mockOperation);
        op.meta.eventHash = eventHash;
        op.meta.eventOrder = i;
        op.operation.record.id = `https://example.com/${uuid()}`;
        op.recordId = database.hash(op.operation.record.id);
        try {
          await operationCollection.insert(op);
        } catch(e) {
          // do nothing
        }
      }
    }
  });
  it('sits doing nothing', async function() {
    this.timeout(0);
    while(true) {
      await delay(60000);
    }
  });
});
