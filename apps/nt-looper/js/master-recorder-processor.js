// Captura PCM estéreo da saída master sem compressão ou conversão para WebM.

class NSMasterRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.chunkSize = 4096;
    this.left = new Float32Array(this.chunkSize);
    this.right = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'start') {
        this.writeIndex = 0;
        this.recording = true;
      } else if (message.type === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'stopped', sampleRate });
      }
    };
  }

  flush() {
    if (!this.writeIndex) return;
    const left = this.left.slice(0, this.writeIndex);
    const right = this.right.slice(0, this.writeIndex);
    this.port.postMessage({ type: 'chunk', left, right }, [left.buffer, right.buffer]);
    this.writeIndex = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const inL = input[0] || null;
    const inR = input[1] || input[0] || null;
    const outL = output[0] || null;
    const outR = output[1] || output[0] || null;
    const length = outL ? outL.length : (inL ? inL.length : 128);

    for (let i = 0; i < length; i++) {
      const left = inL ? inL[i] : 0;
      const right = inR ? inR[i] : left;
      if (outL) outL[i] = left;
      if (outR && outR !== outL) outR[i] = right;
      if (!this.recording) continue;
      this.left[this.writeIndex] = left;
      this.right[this.writeIndex] = right;
      this.writeIndex++;
      if (this.writeIndex >= this.chunkSize) this.flush();
    }
    return true;
  }
}

registerProcessor('ns-master-recorder', NSMasterRecorderProcessor);
