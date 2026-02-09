/**
 * Standalone JavaScript animation runtime for Inamate HTML export.
 * This string is embedded in the exported HTML to replay animations
 * without WASM. It replicates the core engine: keyframe evaluation,
 * matrix composition, scene graph traversal, and Canvas2D rendering.
 */

export const RUNTIME_JS = `
(function() {
  'use strict';

  // --- Easing functions ---
  function bounceOut(t) {
    var n1 = 7.5625, d1 = 2.75;
    if (t < 1/d1) return n1*t*t;
    if (t < 2/d1) { t -= 1.5/d1; return n1*t*t + 0.75; }
    if (t < 2.5/d1) { t -= 2.25/d1; return n1*t*t + 0.9375; }
    t -= 2.625/d1; return n1*t*t + 0.984375;
  }

  function ease(t, type) {
    switch (type) {
      case 'linear': return t;
      case 'easeIn': return t*t;
      case 'easeOut': return t*(2-t);
      case 'easeInOut': return t < 0.5 ? 2*t*t : -1 + (4-2*t)*t;
      case 'cubicIn': return t*t*t;
      case 'cubicOut': var u = 1-t; return 1 - u*u*u;
      case 'cubicInOut':
        if (t < 0.5) return 4*t*t*t;
        var v = -2*t+2; return 1 - v*v*v/2;
      case 'backIn':
        var c1 = 1.70158, c3 = c1+1;
        return c3*t*t*t - c1*t*t;
      case 'backOut':
        var c1b = 1.70158, c3b = c1b+1, tb = t-1;
        return 1 + c3b*tb*tb*tb + c1b*tb*tb;
      case 'backInOut':
        var c2 = 1.70158*1.525;
        if (t < 0.5) return (2*t)*(2*t)*((c2+1)*2*t - c2)/2;
        var w = 2*t-2; return (w*w*((c2+1)*w + c2) + 2)/2;
      case 'elasticOut':
        if (t === 0 || t === 1) return t;
        var c4 = (2*Math.PI)/3;
        return Math.pow(2, -10*t) * Math.sin((t*10 - 0.75)*c4) + 1;
      case 'bounceOut': return bounceOut(t);
      default: return t;
    }
  }

  // --- Keyframe evaluation ---
  function evaluateTimeline(doc, timelineId, frame) {
    var tl = doc.timelines[timelineId];
    if (!tl) return {};
    var overrides = {};
    for (var i = 0; i < tl.tracks.length; i++) {
      var track = doc.tracks[tl.tracks[i]];
      if (!track) continue;
      var kfs = [];
      for (var j = 0; j < track.keys.length; j++) {
        var kf = doc.keyframes[track.keys[j]];
        if (kf) kfs.push(kf);
      }
      kfs.sort(function(a, b) { return a.frame - b.frame; });
      if (kfs.length === 0) continue;
      var prev = null, next = null;
      for (var k = 0; k < kfs.length; k++) {
        if (kfs[k].frame <= frame) prev = kfs[k];
        if (kfs[k].frame >= frame && next === null) next = kfs[k];
      }
      var val;
      if (!prev && next) val = next.value;
      else if (!next && prev) val = prev.value;
      else if (prev === next || prev.frame === next.frame) val = prev.value;
      else {
        var t = (frame - prev.frame) / (next.frame - prev.frame);
        var et = ease(t, prev.easing || 'linear');
        if (typeof prev.value === 'number' && typeof next.value === 'number') {
          val = prev.value + (next.value - prev.value) * et;
        } else {
          val = et < 0.5 ? prev.value : next.value;
        }
      }
      if (!overrides[track.objectId]) overrides[track.objectId] = {};
      overrides[track.objectId][track.property] = val;
    }
    return overrides;
  }

  // --- Matrix math ---
  function mmul(a, b) {
    return [
      a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
      a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
      a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]
    ];
  }

  function fromTransform(x, y, sx, sy, r, ax, ay, skX, skY) {
    var m = [1,0,0,1,-ax,-ay]; // T(-ax,-ay)
    m = mmul([sx,0,0,sy,0,0], m); // S
    if (skX || skY) {
      var rad = Math.PI/180;
      m = mmul([1,Math.tan((skY||0)*rad),Math.tan((skX||0)*rad),1,0,0], m);
    }
    if (r) {
      var rad2 = r*Math.PI/180;
      var c = Math.cos(rad2), s = Math.sin(rad2);
      m = mmul([c,s,-s,c,0,0], m);
    }
    m = mmul([1,0,0,1,x,y], m); // T(x,y)
    return m;
  }

  // --- Shape generation ---
  function rectPath(data) {
    var w = data.width, h = data.height;
    return [['M',0,0],['L',w,0],['L',w,h],['L',0,h],['Z']];
  }

  function ellipsePath(data) {
    var rx = data.rx, ry = data.ry;
    var k = 0.5522847498;
    var kx = rx*k, ky = ry*k;
    return [
      ['M',rx,0],['C',rx,ky,kx,ry,0,ry],
      ['C',-kx,ry,-rx,ky,-rx,0],
      ['C',-rx,-ky,-kx,-ry,0,-ry],
      ['C',kx,-ry,rx,-ky,rx,0],['Z']
    ];
  }

  // --- Scene graph build + compile ---
  function buildAndRender(ctx, canvas, doc, sceneId, frame) {
    var scene = doc.scenes[sceneId];
    if (!scene) return;
    var rootObj = doc.objects[scene.root];
    if (!rootObj) return;
    var overrides = evaluateTimeline(doc, doc.project.rootTimeline, frame);

    // Clear
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (scene.background) {
      ctx.fillStyle = scene.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.restore();

    // Recurse
    renderNode(ctx, doc, rootObj, [1,0,0,1,0,0], 1, overrides, frame);
  }

  function renderNode(ctx, doc, obj, parentMatrix, parentOpacity, overrides, frame) {
    if (!obj || !obj.visible) return;

    var t = {
      x: obj.transform.x, y: obj.transform.y,
      sx: obj.transform.sx, sy: obj.transform.sy,
      r: obj.transform.r, ax: obj.transform.ax, ay: obj.transform.ay,
      skewX: obj.transform.skewX || 0, skewY: obj.transform.skewY || 0
    };
    var style = {
      fill: obj.style.fill, stroke: obj.style.stroke,
      strokeWidth: obj.style.strokeWidth, opacity: obj.style.opacity
    };

    // Apply overrides
    var ov = overrides[obj.id];
    if (ov) {
      for (var key in ov) {
        var parts = key.split('.');
        if (parts[0] === 'transform') t[parts[1]] = ov[key];
        if (parts[0] === 'style') style[parts[1]] = ov[key];
      }
    }

    var localM = fromTransform(t.x, t.y, t.sx, t.sy, t.r, t.ax, t.ay, t.skewX, t.skewY);
    var worldM = mmul(parentMatrix, localM);
    var opacity = parentOpacity * style.opacity;

    // Draw content
    var path = null;
    if (obj.type === 'ShapeRect') path = rectPath(obj.data);
    else if (obj.type === 'ShapeEllipse') path = ellipsePath(obj.data);
    else if (obj.type === 'VectorPath' && obj.data && obj.data.commands) path = obj.data.commands;

    if (path && path.length > 0) {
      ctx.save();
      ctx.transform(worldM[0], worldM[1], worldM[2], worldM[3], worldM[4], worldM[5]);
      ctx.globalAlpha = opacity;
      var p2d = new Path2D();
      for (var i = 0; i < path.length; i++) {
        var c = path[i];
        switch (c[0]) {
          case 'M': p2d.moveTo(c[1], c[2]); break;
          case 'L': p2d.lineTo(c[1], c[2]); break;
          case 'C': p2d.bezierCurveTo(c[1],c[2],c[3],c[4],c[5],c[6]); break;
          case 'Q': p2d.quadraticCurveTo(c[1],c[2],c[3],c[4]); break;
          case 'Z': p2d.closePath(); break;
        }
      }
      if (style.fill && style.fill !== 'none') {
        ctx.fillStyle = style.fill;
        ctx.fill(p2d);
      }
      if (style.stroke && style.stroke !== 'none' && style.strokeWidth > 0) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.strokeWidth;
        ctx.stroke(p2d);
      }
      ctx.restore();
    }

    // Render Text
    if (obj.type === 'Text' && obj.data && obj.data.content) {
      var d = obj.data;
      if (ov) {
        var td = {};
        for (var dk in d) td[dk] = d[dk];
        for (var ok in ov) {
          if (ok.indexOf('data.') === 0) td[ok.slice(5)] = ov[ok];
        }
        d = td;
      }
      ctx.save();
      ctx.transform(worldM[0], worldM[1], worldM[2], worldM[3], worldM[4], worldM[5]);
      ctx.globalAlpha = opacity;
      ctx.font = (d.fontWeight || 'normal') + ' ' + (d.fontSize || 16) + 'px ' + (d.fontFamily || 'sans-serif');
      ctx.textAlign = d.textAlign || 'left';
      ctx.textBaseline = 'top';
      if (style.fill && style.fill !== 'none') {
        ctx.fillStyle = style.fill;
        ctx.fillText(d.content, 0, 0);
      }
      if (style.stroke && style.stroke !== 'none' && style.strokeWidth > 0) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.strokeWidth;
        ctx.strokeText(d.content, 0, 0);
      }
      ctx.restore();
    }

    // Render RasterImage
    if (obj.type === 'RasterImage' && obj.data && obj.data.assetId) {
      var asset = doc.assets[obj.data.assetId];
      if (asset && asset._img && asset._img.complete) {
        ctx.save();
        ctx.transform(worldM[0], worldM[1], worldM[2], worldM[3], worldM[4], worldM[5]);
        ctx.globalAlpha = opacity;
        ctx.drawImage(asset._img, 0, 0, obj.data.width, obj.data.height);
        ctx.restore();
      }
    }

    // Evaluate Symbol nested timeline
    if (obj.type === 'Symbol' && obj.data && obj.data.timelineId) {
      var symOverrides = evaluateTimeline(doc, obj.data.timelineId, frame);
      for (var symObjId in symOverrides) {
        if (!overrides[symObjId]) overrides[symObjId] = {};
        for (var symKey in symOverrides[symObjId]) {
          overrides[symObjId][symKey] = symOverrides[symObjId][symKey];
        }
      }
    }

    // Children
    for (var j = 0; j < obj.children.length; j++) {
      var child = doc.objects[obj.children[j]];
      renderNode(ctx, doc, child, worldM, opacity, overrides, frame);
    }
  }

  // --- Player ---
  function createPlayer(doc, canvasEl) {
    var ctx = canvasEl.getContext('2d');
    var fps = doc.project.fps || 24;
    var tl = doc.timelines[doc.project.rootTimeline];
    var totalFrames = tl ? tl.length : 48;
    var sceneId = doc.project.scenes[0];
    var frame = 0;
    var playing = false;
    var intervalId = null;

    // Preload images
    for (var assetId in doc.assets) {
      var a = doc.assets[assetId];
      if (a.url) {
        var img = new Image();
        img.src = a.url;
        a._img = img;
      }
    }

    function render() {
      buildAndRender(ctx, canvasEl, doc, sceneId, frame);
    }

    function tick() {
      if (playing) {
        frame = (frame + 1) % totalFrames;
      }
      render();
      updateUI();
    }

    function play() {
      if (playing) return;
      playing = true;
      intervalId = setInterval(tick, 1000/fps);
      updateUI();
    }

    function pause() {
      playing = false;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      updateUI();
    }

    function seek(f) {
      frame = Math.max(0, Math.min(f, totalFrames - 1));
      render();
      updateUI();
    }

    function updateUI() {
      var btn = document.getElementById('play-btn');
      if (btn) btn.textContent = playing ? 'Pause' : 'Play';
      var scrub = document.getElementById('scrubber');
      if (scrub) scrub.value = frame;
      var lbl = document.getElementById('frame-label');
      if (lbl) lbl.textContent = frame + ' / ' + totalFrames;
    }

    // Wire controls
    var btn = document.getElementById('play-btn');
    if (btn) btn.addEventListener('click', function() { playing ? pause() : play(); });
    var scrub = document.getElementById('scrubber');
    if (scrub) {
      scrub.max = totalFrames - 1;
      scrub.addEventListener('input', function() { seek(parseInt(scrub.value)); });
    }

    // Scene switcher
    var sceneSel = document.getElementById('scene-select');
    if (doc.project.scenes.length > 1 && sceneSel) {
      sceneSel.style.display = '';
      for (var si = 0; si < doc.project.scenes.length; si++) {
        var opt = document.createElement('option');
        var sc = doc.scenes[doc.project.scenes[si]];
        opt.value = doc.project.scenes[si];
        opt.textContent = sc.name || ('Scene ' + (si + 1));
        sceneSel.appendChild(opt);
      }
      sceneSel.addEventListener('change', function() {
        sceneId = sceneSel.value;
        var sc = doc.scenes[sceneId];
        canvasEl.width = sc.width;
        canvasEl.height = sc.height;
        frame = 0;
        render();
        updateUI();
      });
    }

    // Initial render
    canvasEl.width = doc.scenes[sceneId].width;
    canvasEl.height = doc.scenes[sceneId].height;
    render();
    updateUI();

    return { play: play, pause: pause, seek: seek };
  }

  // Boot
  window.addEventListener('DOMContentLoaded', function() {
    var canvasEl = document.getElementById('animation-canvas');
    if (!canvasEl || !window.__INAMATE_PROJECT__) return;
    window.__player = createPlayer(window.__INAMATE_PROJECT__, canvasEl);
  });
})();
`;
