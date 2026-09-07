'use strict';

const { Cluster, BoundCluster, ZCLDataType } = require('zigbee-clusters');
const { ZCLStandardHeader } = require('zigbee-clusters/lib/zclFrames');

function uintToBuf(buf, v, i) {
  return buf.writeUInt32LE(v, i, this.length) - i;
}
function uintFromBuf(buf, i) {
  if (buf.length - i < this.length) return 0;
  return buf.readUInt32LE(i, this.length);
}

const DATATYPE_UTC = new ZCLDataType(0xE2, 'uint32', 4, uintToBuf, uintFromBuf);
const DATATYPE_UTC2 = new ZCLDataType(0x23, 'uint32', 4, uintToBuf, uintFromBuf);

class SonoffTimeBoundCluster extends BoundCluster {
  constructor(endpoint) {
    super();
    this.ep = endpoint;
  }
  static get ID() { return 10; }
  static get NAME() { return 'time'; }
  static get ATTRIBUTES() {
    return {
      time: { id: 0, type: DATATYPE_UTC },
      local_time: { id: 7, type: DATATYPE_UTC2 },
    };
  }
  get time() { return this._timeSince2000(new Date()); }
  get local_time() { return this._timeSince2000(new Date()); }
  _timeSince2000(date) {
    const year2000 = new Date('2000-01-01T00:00:00Z');
    return Math.floor((date.getTime() - year2000.getTime()) / 1000) >>> 0;
  }
  async handleFrame(frame, meta, rawFrame) {
    this.frame = frame;
    return await super.handleFrame(frame, meta, rawFrame);
  }
  async readAttributes({ attributes }) {
    const result = await super.readAttributes({ attributes });
    const resp = new ZCLStandardHeader();
    resp.frameControl.directionToClient = true;
    resp.frameControl.disableDefaultResponse = true;
    resp.trxSequenceNumber = this.frame.trxSequenceNumber;
    resp.cmdId = 1;
    resp.data = result.attributes;
    await this.ep._node.sendFrame(1, SonoffTimeBoundCluster.ID, resp.toBuffer());
    return result;
  }
}

try {
  Cluster.addCluster(SonoffTimeBoundCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

module.exports = SonoffTimeBoundCluster;
