let cvReadyPromise = null;

function ensureCv() {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = new Promise((resolve, reject) => {
    try {
      importScripts('https://docs.opencv.org/4.x/opencv.js');
      const finish = () => {
        if (self.cv?.Mat) resolve(self.cv);
        else if (self.cv) self.cv.onRuntimeInitialized = () => resolve(self.cv);
        else reject(new Error('OpenCV não foi carregado no worker.'));
      };
      finish();
    } catch (error) {
      reject(error);
    }
  });
  return cvReadyPromise;
}

function ordenarPontos(pontos) {
  const pts = pontos.map(p => ({ x:Number(p.x), y:Number(p.y) }));
  const soma = p => p.x + p.y, dif = p => p.x - p.y;
  return [
    pts.reduce((a,b)=>soma(a)<soma(b)?a:b),
    pts.reduce((a,b)=>dif(a)>dif(b)?a:b),
    pts.reduce((a,b)=>soma(a)>soma(b)?a:b),
    pts.reduce((a,b)=>dif(a)<dif(b)?a:b)
  ];
}

function pontosPadrao(w,h) {
  const m = Math.max(12, Math.min(w,h) * .06);
  return [{x:m,y:m},{x:w-m,y:m},{x:w-m,y:h-m},{x:m,y:h-m}];
}

async function bitmapFromBuffer(buffer, type) {
  const blob = new Blob([buffer], { type: type || 'image/jpeg' });
  return createImageBitmap(blob);
}

function matFromBitmap(bitmap, maxDim = 1000) {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha:false, willReadFrequently:true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { mat: cv.matFromImageData(imageData), width, height, scale };
}

function detectarQuadrilateroMat(src, scale, originalWidth, originalHeight) {
  const gray = new cv.Mat(), blur = new cv.Mat(), edges = new cv.Mat();
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  let melhor = null, melhorArea = 0;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    cv.Canny(blur, edges, 45, 145);
    const kernel = cv.Mat.ones(3,3,cv.CV_8U);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.dilate(edges, edges, kernel);
    kernel.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const minArea = src.cols * src.rows * .08;
    for (let i=0; i<contours.size(); i++) {
      const cnt = contours.get(i), peri = cv.arcLength(cnt,true), approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, .02*peri, true);
      const area = Math.abs(cv.contourArea(approx));
      if (approx.rows === 4 && area > minArea && area > melhorArea && cv.isContourConvex(approx)) {
        const p=[];
        for(let j=0;j<4;j++) p.push({x:approx.intPtr(j,0)[0]/scale,y:approx.intPtr(j,0)[1]/scale});
        melhor = ordenarPontos(p); melhorArea = area;
      }
      approx.delete(); cnt.delete();
    }
  } finally {
    gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete();
  }
  return melhor || pontosPadrao(originalWidth, originalHeight);
}

function dimensoesDestino([tl,tr,br,bl]) {
  const top=Math.hypot(tr.x-tl.x,tr.y-tl.y), bottom=Math.hypot(br.x-bl.x,br.y-bl.y);
  const left=Math.hypot(bl.x-tl.x,bl.y-tl.y), right=Math.hypot(br.x-tr.x,br.y-tr.y);
  let w=Math.max(top,bottom), h=Math.max(left,right);
  const max=1800, scale=Math.min(1.35,max/Math.max(w,h));
  return {w:Math.max(320,Math.round(w*scale)),h:Math.max(420,Math.round(h*scale))};
}

function melhorarMatOCR(src) {
  const gray=new cv.Mat(), denoise=new cv.Mat(), bin=new cv.Mat();
  cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
  cv.bilateralFilter(gray,denoise,5,38,38);
  cv.adaptiveThreshold(denoise,bin,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,11);
  gray.delete(); denoise.delete();
  return bin;
}

async function detectar(payload) {
  await ensureCv();
  const bitmap = await bitmapFromBuffer(payload.buffer, payload.type);
  try {
    const { mat, scale } = matFromBitmap(bitmap, 1000);
    try {
      return detectarQuadrilateroMat(mat, scale, bitmap.width, bitmap.height);
    } finally { mat.delete(); }
  } finally { bitmap.close(); }
}

async function processar(payload) {
  await ensureCv();
  const bitmap = await bitmapFromBuffer(payload.buffer, payload.type);
  try {
    const inputMax = 2200;
    const scale = Math.min(1, inputMax / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha:false, willReadFrequently:true });
    ctx.drawImage(bitmap,0,0,width,height);
    const src = cv.matFromImageData(ctx.getImageData(0,0,width,height));
    const pts = ordenarPontos(payload.points).map(p => ({x:p.x*scale,y:p.y*scale}));
    const dim = dimensoesDestino(pts);
    const dst = new cv.Mat();
    const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,pts.flatMap(p=>[p.x,p.y]));
    const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,dim.w-1,0,dim.w-1,dim.h-1,0,dim.h-1]);
    const M=cv.getPerspectiveTransform(srcPts,dstPts);
    try {
      cv.warpPerspective(src,dst,M,new cv.Size(dim.w,dim.h),cv.INTER_LINEAR,cv.BORDER_REPLICATE,new cv.Scalar());
      const tratado=melhorarMatOCR(dst);
      const rgba = new cv.Mat();
      try {
        cv.cvtColor(tratado, rgba, cv.COLOR_GRAY2RGBA);
        const outCanvas = new OffscreenCanvas(dim.w, dim.h);
        const outCtx = outCanvas.getContext('2d');
        const pixels = new Uint8ClampedArray(rgba.data);
        const imageData = new ImageData(pixels, rgba.cols, rgba.rows);
        outCtx.putImageData(imageData,0,0);
        const blob = await outCanvas.convertToBlob({type:'image/jpeg', quality:.9});
        return { buffer: await blob.arrayBuffer(), type: blob.type };
      } finally { tratado.delete(); rgba.delete(); }
    } finally {
      src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
    }
  } finally { bitmap.close(); }
}

self.onmessage = async event => {
  const { id, action, payload } = event.data || {};
  try {
    const result = action === 'detect' ? await detectar(payload) : await processar(payload);
    const transfer = result?.buffer ? [result.buffer] : [];
    self.postMessage({ id, ok:true, result }, transfer);
  } catch (error) {
    self.postMessage({ id, ok:false, error: error?.message || String(error) });
  }
};
