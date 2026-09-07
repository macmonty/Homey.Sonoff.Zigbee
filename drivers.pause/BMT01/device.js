'use strict';

const { Device } = require('homey');
module.exports = class BMT01Device extends Device {
    static SYNC_INTERVAL = 1000 * 60 * 5; // 5 min 
    static PERIPHERAL_TIMEOUT = 1000 * 30; // 30 sec
  
  onInit() {
    this.log('BMT01 device is initializing...');

    this.onSync = this.onSync.bind(this);
    this.onSyncInterval = setInterval(this.onSync, this.constructor.SYNC_INTERVAL);
    this.onSync() // do an initial sync
    this.log(`PlaybulbCandleDevice has been inited`);
  }

  async getPeripheral() {
    if (!this.advertisement)
      throw new Error('Advertisement Unavailable');

    if (!this._peripheral) {
      this.log('Connecting to peripheral...');
      const peripheral = await this.advertisement.connect();
      await peripheral.assertConnected();
      const services = await peripheral.discoverAllServicesAndCharacteristics();
      services.forEach(service => {
        if (service.uuid === "0000aaaa00001000800000805f9b34fb") {
          this.log(`Found characteristic: ${service.uuid}`);
          service.on('data', (data) => {
            this.log(`Serv Received data: ${data.toString('hex')}`);
          });
          service.on('error', (error) => {
            this.error(`Service error: ${error}`);
          });
          service.characteristics.forEach(characteristic => {            
            if (characteristic.uuid === "0000bbb100001000800000805f9b34fb" || characteristic.uuid === "0000bbb300001000800000805f9b34fb") {
              this.log(`Found characteristic: ${characteristic.uuid}`);
              characteristic.on('data', (data) => {
                this.log(`Ch Received data: ${data.toString('hex')}`);
              });
              characteristic.on('error', (error) => {
                this.error(`Characteristic error: ${error}`);
              });
            }
          });
        }
      });
      this._peripheral = peripheral;
      this.setAvailable(true);
    }

    return this._peripheral;
  }

  onSync() {
    this.log('Syncing...');

    const { address } = this.getData();

    this.driver
      .getAdvertisement({ address })
      .then(async (advertisement) => {
      
        this.setAvailable().catch(this.error);
        this.advertisement = advertisement;

        const peripheral = await this.getPeripheral();

      /*
      if (this.HAS_BATTERY()) {
        await peripheral.read(this.constructor.SERVICE_BATTERY_UUID, this.constructor.SERVICE_BATTERY_CHARACTERISTIC_BATTERY_LEVEL_UUID).then(async ([batteryLevel]) => {
          await this.setCapabilityValue('measure_battery', batteryLevel);
        }).catch(this.error);	
      }

      await peripheral.read(this.SERVICE_LIGHT_UUID(), this.constructor.SERVICE_LIGHT_CHARACTERISTIC_COLOR_UUID).then(async ([w, r, g, b]) => {
        
        // don't sync the values if the bulb is off
        // otherwise it will sync a dim level of 0 and a color of 0, 0, 0
        if (w === 0 && r === 0 && g === 0 && b === 0) {
          return this.setCapabilityValue('onoff', false);
        }
        this.setCapabilityValue('onoff', true);

        if (w > 0) {
          await this.setCapabilityValue('light_mode', 'temperature');
          await this.setCapabilityValue('dim', w / 255);
        } else {
          const [h, s, v] = MipowUtil.rgb2hsv(r, g, b);
          await this.setCapabilityValue('light_mode', 'color');
          await this.setCapabilityValue('dim', v);
        }
      }).catch(this.error);
      */
    }).catch(err => {
      this.error(err);
      this.setUnavailable(err).catch(this.error);
    });
  }

  onDeleted() {
    if (this._peripheral) this._peripheral.disconnect();
    if (this.onSyncInterval) clearInterval(this.onSyncInterval);
  } 

}