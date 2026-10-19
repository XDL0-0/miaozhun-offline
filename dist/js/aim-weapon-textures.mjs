// Share immutable source textures between live gun/knife controllers. A model
// owns a lease, so switching one weapon cannot dispose another weapon's maps.
const pools=new WeakMap();
export function createWeaponTextureLease(Texture){
  let pool=pools.get(Texture);if(!pool){pool=new Map();pools.set(Texture,pool);}
  const owned=new Map();let disposed=false;
  return {
    acquire(key,create){
      if(disposed)throw new Error('Weapon texture lease disposed');
      if(owned.has(key))return owned.get(key).texture;
      let entry=pool.get(key);
      if(!entry){entry={texture:create(),refs:0};pool.set(key,entry);}
      entry.refs++;owned.set(key,entry);return entry.texture;
    },
    dispose(){
      if(disposed)return;disposed=true;
      for(const [key,entry]of owned)if(--entry.refs===0){pool.delete(key);entry.texture.dispose();}
      owned.clear();
    }
  };
}

export function weaponAssetBytes(assets){
  const buffers=new Set(),images=new Set();let bytes=0;
  for(const picture of assets.pictures.values())if(!images.has(picture)){
    images.add(picture);bytes+=(picture.naturalWidth??picture.width??0)*(picture.naturalHeight??picture.height??0)*4;
  }
  const add=value=>{if(ArrayBuffer.isView(value)&&!buffers.has(value.buffer)){buffers.add(value.buffer);bytes+=value.buffer.byteLength;}};
  for(const part of assets.parts)for(const primitive of part.data.primitives)Object.values(primitive).forEach(add);
  for(const clip of Object.values(assets.motions?.clips??{}))add(clip.values);
  for(const env of assets.environments?.values()??[])add(env.pixels);
  return bytes;
}
