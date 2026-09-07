'use strict';

const { Driver } = require('homey');
module.exports = class BMT01Driver extends Driver {

  static DISCOVER_INTERVAL = 1000 * 60 * 1; // 1 minute

  async onInit() {
    this.advertisements = {};
    this.onDiscover = this.onDiscover.bind(this);
    this.onDiscoverInterval = setInterval(this.onDiscover, this.constructor.DISCOVER_INTERVAL);
    await this.onDiscover();
  }

  async onDiscover() {
    this.log('Discovering...');
    //const advertisements = await this.homey.ble.discover(["0000180000001000800000805f9b34fb"]).catch(this.error);
    const advertisements = await this.homey.ble.discover().catch(this.error);
    this.log(`Found ${advertisements.length} devices.`)
    advertisements.forEach(advertisement => {
      if (advertisement.uuid=='bcbd010427d0') {
        if (!this.advertisements[advertisement.address]) {
          this.advertisements[advertisement.address] = advertisement;
          this.emit(`advertisement:${advertisement.address}`, advertisement);
        }
      }
    });
  }

  async onPairListDevices() {
    this.log('Pairing...');
    return Object.entries(this.advertisements).map(([address, advertisement]) => ({
      data: { address },
      name: advertisement.localName,
    }));
  }

  async getAdvertisement({ address }) {
    if (this.advertisements[address])
      return this.advertisements[address];

    return new Promise(resolve => {
      this.once(`advertisement:${address}`, resolve);
    })
  }

}