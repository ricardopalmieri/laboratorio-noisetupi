// NT Sampler 2.6 - lightweight shared performance FX for pads and master bus.
// One AudioWorklet per active pad replaces three per-voice worklets.
// No long ring buffers and no allocation inside process().
class NTPadPerformanceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = {
      bpm:120, transportOriginFrame:0, 'engine.active':1,
      'patternSlicer.on':0, 'patternSlicer.mix':1, 'patternSlicer.pattern':0, 'patternSlicer.rate':4, 'patternSlicer.duty':.5, 'patternSlicer.attack':.02, 'patternSlicer.depth':.85,
      'stepSlicer.on':0, 'stepSlicer.mix':1, 'stepSlicer.rate':4, 'stepSlicer.depth':.85,
      'scatter.on':0, 'scatter.mix':.62, 'scatter.rate':4, 'scatter.depth':.82, 'scatter.pattern':0,
      'glitch.on':0, 'glitch.mix':.48, 'glitch.bits':8, 'glitch.hold':3, 'glitch.dropout':.08,
      'oscBot.on':0, 'oscBot.mix':.55, 'oscBot.dryInput':0, 'oscBot.wave':0, 'oscBot.tone':0, 'oscBot.attack':50, 'oscBot.note':36, 'oscBot.sens':0, 'oscBot.balance':.72,
      'oscBot.seqOn':1, 'oscBot.seqSync':1, 'oscBot.seqRate':2, 'oscBot.seqSteps':16, 'oscBot.seqGate':.68,
    };
    for (let i=0;i<16;i++) {
      this.params[`stepSlicer.step${i}`] = (i & 1) ? .18 : 1;
      this.params[`oscBot.step${i}`] = [0,0,7,0,3,0,10,7,0,12,7,3,0,-5,3,7][i];
    }
    this.oscPhaseA=0; this.oscPhaseB=0; this.oscEnvelope=0; this.oscToneL=0; this.oscToneR=0;
    this.oscLastMidi=-1; this.oscIncA=0; this.oscIncB=0;
    this.scatterSize=Math.ceil(sampleRate*1.15);this.scatterL=new Float32Array(this.scatterSize);this.scatterR=new Float32Array(this.scatterSize);this.scatterWrite=0;this.totalSamples=0;
    this.glitchL=0;this.glitchR=0;
    this.port.onmessage = e => {
      const m=e.data||{};
      if(m.type==='param') this.params[m.id] = typeof m.value === 'boolean' ? (m.value?1:0) : Number(m.value);
    };
  }
  clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  at(buffer,index){let p=index%this.scatterSize;if(p<0)p+=this.scatterSize;const a=Math.floor(p),b=(a+1)%this.scatterSize,m=p-a;return buffer[a]+(buffer[b]-buffer[a])*m;}
  osc(phase,wave){
    const saw=phase*2-1;
    if(wave===1)return saw*(1.72-.72*Math.abs(saw))*.88;
    if(wave===3)return phase<.5?1:-1;
    if(wave===4)return phase<.25?1:-1;
    return saw;
  }
  process(inputs,outputs){
    const input=inputs[0]||[], output=outputs[0];
    if(!output||!output[0])return true;
    const inL=input[0]||null, inR=input[1]||input[0]||null, outL=output[0], outR=output[1]||output[0];
    const bpm=this.clamp(Number(this.params.bpm)||120,30,300);
    const beatFrames=sampleRate*60/bpm;
    const origin=Math.round(Number(this.params.transportOriginFrame)||0);
    const engineActive=this.params['engine.active']>.5;
    if(!engineActive){
      if(this.wasActive!==false){this.oscEnvelope=0;this.oscToneL=0;this.oscToneR=0;this.glitchL=0;this.glitchR=0;this.totalSamples=0;}
      this.wasActive=false;
      for(let i=0;i<outL.length;i++){const l=inL?inL[i]:0,r=inR?inR[i]:l;outL[i]=l;if(outR!==outL)outR[i]=r;}
      return true;
    }
    this.wasActive=true;
    const psOn=this.params['patternSlicer.on']>.5, ssOn=this.params['stepSlicer.on']>.5, scatterOn=this.params['scatter.on']>.5, glitchOn=this.params['glitch.on']>.5, oscOn=this.params['oscBot.on']>.5;
    const psMix=this.clamp(this.params['patternSlicer.mix']||0,0,1), psRate=Math.max(1,Math.round(this.params['patternSlicer.rate']||4)), psDuty=this.clamp(this.params['patternSlicer.duty']||.5,.05,.95), psDepth=this.clamp(this.params['patternSlicer.depth']||0,0,1), psAttack=Math.max(.002,this.params['patternSlicer.attack']||.02), psPattern=Math.round(this.params['patternSlicer.pattern']||0);
    const ssMix=this.clamp(this.params['stepSlicer.mix']||0,0,1), ssRate=Math.max(1,Math.round(this.params['stepSlicer.rate']||4)), ssDepth=this.clamp(this.params['stepSlicer.depth']||0,0,1);
    const scatterMix=this.clamp(this.params['scatter.mix']||0,0,1), scatterRate=Math.max(1,Math.round(this.params['scatter.rate']||4)), scatterDepth=this.clamp(this.params['scatter.depth']||0,0,1), scatterPattern=Math.round(this.params['scatter.pattern']||0);
    const glitchMix=this.clamp(this.params['glitch.mix']||0,0,1), glitchBits=this.clamp(Math.round(this.params['glitch.bits']||8),3,16), glitchHold=this.clamp(Math.round(this.params['glitch.hold']||3),1,32), glitchDrop=this.clamp(this.params['glitch.dropout']||0,0,.45);
    const oscMix=this.clamp(this.params['oscBot.mix']||0,0,1), oscWave=Math.round(this.params['oscBot.wave']||0), oscSens=Math.pow(10,(this.params['oscBot.sens']||0)/40), oscBal=this.clamp(this.params['oscBot.balance']||0,0,1), oscDry=this.params['oscBot.dryInput']>=.5?1:0;
    const oscAttack=.002+Math.pow((this.params['oscBot.attack']||0)/100,2)*.22, oscAttackAlpha=1-Math.exp(-1/Math.max(1,sampleRate*oscAttack)), oscReleaseAlpha=1-Math.exp(-1/(sampleRate*.12));
    const oscCut=this.clamp(5200*Math.pow(2,(this.params['oscBot.tone']||0)/50),650,sampleRate*.44), toneAlpha=1-Math.exp(-2*Math.PI*oscCut/sampleRate);
    const oscSteps=this.clamp(Math.round(this.params['oscBot.seqSteps']||16),1,16), rateBeats=[1,.5,.25,.125][this.clamp(Math.round(this.params['oscBot.seqRate']||2),0,3)]||.25;
    const oscStepFrames=Math.max(1,(this.params['oscBot.seqSync']>.5?beatFrames:sampleRate)*rateBeats), oscGate=this.clamp(this.params['oscBot.seqGate']||.68,.05,1), oscSeq=this.params['oscBot.seqOn']>.5;
    const psStepFrames=Math.max(1,Math.round(beatFrames/psRate)), ssStepFrames=Math.max(1,Math.round(beatFrames/ssRate)), scatterStepFrames=Math.max(32,Math.round(beatFrames/scatterRate));
    for(let i=0;i<outL.length;i++){
      let l=inL?inL[i]:0, r=inR?inR[i]:l;
      const frame=Math.max(0,currentFrame+i-origin);
      if(psOn){
        const step=Math.floor(frame/psStepFrames)%20, edge=frame%psStepFrames;
        let level=((psPattern*13+step*7)%11)<6?1:0;
        if(edge>psStepFrames*psDuty)level=0;
        const attack=Math.min(1,edge/Math.max(1,psStepFrames*psAttack)), release=Math.min(1,(psStepFrames-edge)/Math.max(1,psStepFrames*.04)), shaped=level*Math.min(attack,release), gain=1-psDepth+shaped*psDepth;
        const wl=l*gain, wr=r*gain; l+= (wl-l)*psMix; r+=(wr-r)*psMix;
      }
      if(ssOn){
        const step=Math.floor(frame/ssStepFrames)%16, level=this.clamp(this.params[`stepSlicer.step${step}`] ?? 1,0,1), gain=1-ssDepth+level*ssDepth, wl=l*gain, wr=r*gain;
        l+=(wl-l)*ssMix; r+=(wr-r)*ssMix;
      }
      this.scatterL[this.scatterWrite]=l;this.scatterR[this.scatterWrite]=r;
      if(scatterOn && this.totalSamples>scatterStepFrames*3){
        const step=Math.floor(frame/scatterStepFrames),local=frame%scatterStepFrames,table=[0,2,1,3,1,0,3,2],choice=table[(step+scatterPattern)%table.length];
        const reverse=((step+scatterPattern)%3)===0,pos=this.scatterWrite-choice*scatterStepFrames-(reverse?(scatterStepFrames-1-local):local);
        const sl=this.at(this.scatterL,pos),sr=this.at(this.scatterR,pos),wl=l*(1-scatterDepth)+sl*scatterDepth,wr=r*(1-scatterDepth)+sr*scatterDepth;
        l+=(wl-l)*scatterMix;r+=(wr-r)*scatterMix;
      }
      if(glitchOn){
        const levels=Math.pow(2,glitchBits-1)-1;if((this.totalSamples%glitchHold)===0){this.glitchL=Math.round(l*levels)/levels;this.glitchR=Math.round(r*levels)/levels;}
        const cell=Math.floor(frame/Math.max(32,Math.round(psStepFrames/2))),hash=(((cell*1103515245+12345)>>>8)&65535)/65535,gate=hash<glitchDrop?0:1,wl=this.glitchL*gate,wr=this.glitchR*gate;
        l+=(wl-l)*glitchMix;r+=(wr-r)*glitchMix;
      }
      if(oscOn){
        const stepPos=frame/oscStepFrames, step=oscSeq?Math.floor(stepPos)%oscSteps:0, offset=oscSeq?(Number(this.params[`oscBot.step${step}`])||0):0, midi=this.clamp((Number(this.params['oscBot.note'])||36)+offset,24,127);
        if(midi!==this.oscLastMidi){const hz=440*Math.pow(2,(midi-69)/12);this.oscIncA=hz/sampleRate;this.oscIncB=hz*1.007/sampleRate;this.oscLastMidi=midi;}
        const gatePhase=stepPos-Math.floor(stepPos), gate=!oscSeq||gatePhase<=oscGate, follower=Math.max(Math.abs(l),Math.abs(r))*oscSens*4, target=gate?Math.min(1,follower):0;
        this.oscEnvelope+=(target-this.oscEnvelope)*(target>this.oscEnvelope?oscAttackAlpha:oscReleaseAlpha);
        let o=this.osc(this.oscPhaseA,oscWave);if(oscWave===2)o=(o+this.osc(this.oscPhaseB,0))*.5;const synth=o*this.oscEnvelope*.88;
        let wl=l*(1-oscBal)*oscDry+synth*oscBal, wr=r*(1-oscBal)*oscDry+synth*oscBal;
        this.oscToneL+=toneAlpha*(wl-this.oscToneL);this.oscToneR+=toneAlpha*(wr-this.oscToneR);wl=this.oscToneL;wr=this.oscToneR;
        l+=(wl-l)*oscMix;r+=(wr-r)*oscMix;
        this.oscPhaseA+=this.oscIncA;this.oscPhaseB+=this.oscIncB;if(this.oscPhaseA>=1)this.oscPhaseA-=1;if(this.oscPhaseB>=1)this.oscPhaseB-=1;
      }
      // Web Audio is floating point internally, so keep this rack linear here.
      // Final dynamics/ceiling belong to the master bus, not to every performance FX node.
      outL[i]=l;if(outR!==outL)outR[i]=r;
      this.scatterWrite=(this.scatterWrite+1)%this.scatterSize;this.totalSamples++;
    }
    return true;
  }
}
registerProcessor('ns-pad-performance',NTPadPerformanceProcessor);
