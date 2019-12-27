const {util: {delay}} = require('bedrock');

describe.only('it just runs nodes', () => {
  it('sits doing nothing', async function() {
    this.timeout(0);
    while(true) {
      await delay(60000);
    }
  });
});
