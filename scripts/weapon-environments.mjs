// Radiance RGBE -> linear, little-endian RGBA16F. This is a build-time
// conversion; the shipped runtime only decompresses the reviewed half floats.
const MAX_PIXELS=32*1024*1024;
const LUMINANCE=[.2126,.7152,.0722];
export function decodeRadianceHDR(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  let at=0;
  const line=()=>{
    const start=at;while(at<bytes.length&&bytes[at]!==10)at++;
    if(at===bytes.length)throw new Error('Truncated Radiance header');
    return new TextDecoder().decode(bytes.subarray(start,at++)).replace(/\r$/,'');
  };
  if(!/^#\?(?:RADIANCE|RGBE)$/.test(line()))throw new Error('Invalid Radiance signature');
  let format='';
  for(let count=0;;count++){
    if(count>100)throw new Error('Radiance header is too long');
    const text=line();if(!text)break;
    if(text.startsWith('FORMAT='))format=text.slice(7);
  }
  if(format!=='32-bit_rle_rgbe')throw new Error('Only RGBE Radiance data is supported');
  const resolution=line().match(/^([+-])Y (\d+) ([+-])X (\d+)$/);
  if(!resolution)throw new Error('Unsupported Radiance orientation');
  const height=Number(resolution[2]),width=Number(resolution[4]);
  if(width<1||height<1||width>16384||height>16384||width*height>MAX_PIXELS)throw new Error('Invalid Radiance dimensions');
  const rgba=new Float32Array(width*height*4),scan=new Uint8Array(width*4);
  const take=()=>{if(at>=bytes.length)throw new Error('Truncated Radiance pixels');return bytes[at++];};
  for(let row=0;row<height;row++){
    if(width>=8&&width<=32767&&bytes[at]===2&&bytes[at+1]===2&&(bytes[at+2]&128)===0){
      take();take();if((take()<<8|take())!==width)throw new Error('Radiance scanline width mismatch');
      for(let channel=0;channel<4;channel++){
        let x=0;
        while(x<width){
          const count=take();if(count===0)throw new Error('Empty Radiance RLE packet');
          if(count>128){
            const run=count-128,value=take();if(x+run>width)throw new Error('Radiance RLE run exceeds scanline');
            for(let i=0;i<run;i++)scan[(x++)*4+channel]=value;
          }else{
            if(x+count>width)throw new Error('Radiance RLE literal exceeds scanline');
            for(let i=0;i<count;i++)scan[(x++)*4+channel]=take();
          }
        }
      }
    }else{
      let x=0,shift=0;
      while(x<width){
        const pixel=[take(),take(),take(),take()];
        if(pixel[0]===1&&pixel[1]===1&&pixel[2]===1){
          const count=pixel[3]*2**shift;
          if(x===0||!count||x+count>width||shift>24)throw new Error('Invalid legacy Radiance run');
          const previous=scan.slice((x-1)*4,x*4);
          for(let i=0;i<count;i++)scan.set(previous,(x++)*4);
          shift+=8;
        }else{scan.set(pixel,(x++)*4);shift=0;}
      }
    }
    const y=resolution[1]==='-'?row:height-1-row;
    for(let column=0;column<width;column++){
      const x=resolution[3]==='+'?column:width-1-column,source=column*4,target=(y*width+x)*4;
      const scale=scan[source+3]?2**(scan[source+3]-136):0;
      rgba[target]=scan[source]*scale;rgba[target+1]=scan[source+1]*scale;rgba[target+2]=scan[source+2]*scale;rgba[target+3]=1;
    }
  }
  return {width,height,rgba};
}

// CUE4Parse preserves cube texel density by rounding each panorama dimension
// separately, hence some genuine 2:1 panoramas have width === 2*height+1.
export function isEnvironmentPanorama(width,height){return width>=2&&height>=1&&Math.abs(width-2*height)<=1;}

export function resizeLinearHDR(image,maxWidth=1024,maxHeight=512){
  const {width,height,rgba}=image;
  if(!isEnvironmentPanorama(width,height))throw new Error('Weapon environment must be a 2:1 panorama');
  if(!Number.isInteger(maxWidth)||!Number.isInteger(maxHeight)||maxWidth<2||maxHeight<1)throw new Error('Invalid environment size cap');
  if(width<=maxWidth&&height<=maxHeight)return {...image,resampled:false};
  const targetHeight=Math.min(maxHeight,Math.floor(maxWidth/2)),targetWidth=targetHeight*2;
  const weights=(source,target)=>Array.from({length:target},(_,i)=>{
    const start=i*source/target,end=(i+1)*source/target,span=end-start,result=[];
    for(let p=Math.floor(start);p<Math.ceil(end);p++)if(p>=0&&p<source)result.push([p,(Math.min(end,p+1)-Math.max(start,p))/span]);
    return result;
  });
  const xs=weights(width,targetWidth),ys=weights(height,targetHeight),output=new Float32Array(targetWidth*targetHeight*4);
  for(let y=0;y<targetHeight;y++)for(let x=0;x<targetWidth;x++){
    const target=(y*targetWidth+x)*4;
    for(const [sy,wy]of ys[y])for(const [sx,wx]of xs[x]){
      const source=(sy*width+sx)*4,w=wx*wy;
      for(let channel=0;channel<3;channel++)output[target+channel]+=rgba[source+channel]*w;
    }
    output[target+3]=1;
  }
  return {width:targetWidth,height:targetHeight,rgba:output,resampled:true};
}

const float=new Float32Array(1),bits=new Uint32Array(float.buffer);
const roundEven=value=>{const low=Math.floor(value),fraction=value-low;return fraction>.5||fraction===.5&&low%2?low+1:low;};
export function floatToHalf(value){
  if(!Number.isFinite(value)||Math.abs(value)>65504)throw new Error('Environment value cannot be represented as finite half float');
  float[0]=value;
  const word=bits[0],sign=word>>>16&0x8000,exponent=(word>>>23&255)-127,fraction=word&0x7fffff;
  if(exponent<-25)return sign;
  if(exponent<-14)return sign|roundEven((fraction|0x800000)/2**(-exponent-1));
  return sign|((exponent+15)<<10)+roundEven(fraction/8192);
}
export function halfToFloat(half){
  const sign=half&0x8000?-1:1,exponent=half>>>10&31,fraction=half&1023;
  return exponent===0?sign*fraction*2**-24:exponent===31?fraction?NaN:sign*Infinity:sign*(1+fraction/1024)*2**(exponent-15);
}
export function encodeRGBA16F(rgba){
  if(rgba.length%4)throw new Error('Invalid environment channel count');
  const bytes=Buffer.allocUnsafe(rgba.length*2);
  for(let i=0;i<rgba.length;i++)bytes.writeUInt16LE(floatToHalf(rgba[i]),i*2);
  return bytes;
}
export function environmentStats(rgba){
  if(!rgba.length||rgba.length%4)throw new Error('Invalid environment pixels');
  const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity],sum=[0,0,0];
  let luminanceSum=0,luminanceMax=0,overOne=0;
  for(let at=0;at<rgba.length;at+=4){
    let luminance=0;
    for(let c=0;c<3;c++){
      const value=rgba[at+c];if(!Number.isFinite(value)||value<0)throw new Error('Invalid linear HDR radiance');
      minimum[c]=Math.min(minimum[c],value);maximum[c]=Math.max(maximum[c],value);sum[c]+=value;luminance+=value*LUMINANCE[c];
    }
    luminanceSum+=luminance;luminanceMax=Math.max(luminanceMax,luminance);
    if(rgba[at]>1||rgba[at+1]>1||rgba[at+2]>1)overOne++;
  }
  const pixels=rgba.length/4;
  return {minimumRGB:minimum,maximumRGB:maximum,meanRGB:sum.map(v=>v/pixels),meanLuminance:luminanceSum/pixels,maximumLuminance:luminanceMax,pixelsAboveOne:overOne,pixels};
}
export function halfEnvironmentStats(bytes){
  if(bytes.length%8)throw new Error('Invalid RGBA16F environment byte length');
  const data=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),rgba=new Float32Array(data.length/2);
  for(let i=0;i<rgba.length;i++)rgba[i]=halfToFloat(data.readUInt16LE(i*2));
  return environmentStats(rgba);
}
