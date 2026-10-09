/**
 * ImageLayer Studio - Advanced HTML5 Layered Image Editor
 * Supports multiple image layers, full alpha/transparency, drag, rotate, resize, blend modes, and export.
 */

(() => {
  'use strict';

  // --- Вспомогательные утилиты геометрии ---
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  function rotatePoint(x, y, rad) {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    };
  }

  function getHandleCursor(baseHandle, rotationDeg) {
    const handleAngles = {
      'n': 0, 'ne': 45, 'e': 90, 'se': 135,
      's': 180, 'sw': 225, 'w': 270, 'nw': 315
    };
    if (baseHandle === 'rot') return 'crosshair';
    if (!(baseHandle in handleAngles)) return 'default';

    let totalAngle = (handleAngles[baseHandle] + rotationDeg) % 360;
    if (totalAngle < 0) totalAngle += 360;

    const index = Math.round(totalAngle / 45) % 8;
    const cursors = [
      'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize',
      'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'
    ];
    return cursors[index];
  }

  function hexToRgb(hex) {
    let cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split('').map(c => c + c).join('');
    }
    const num = parseInt(cleanHex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const h = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('').toUpperCase();
  }

  // --- Состояние приложения ---
  const state = {
    canvasWidth: 1920,
    canvasHeight: 1080,
    canvasBg: 'transparent',
    customBgColor: '#ffffff',
    zoom: 1,
    pan: { x: 0, y: 0 },
    layers: [], // упорядочены снизу вверх (0 - нижний, length-1 - верхний)
    selectedId: null,
    
    // Интерактивное состояние мыши
    interaction: {
      type: 'none', // 'none' | 'move' | 'resize' | 'rotate' | 'pan'
      handle: null, // 'nw', 'ne', 'se', 'sw', 'n', 's', 'e', 'w', 'rot'
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0,
      initialLayerState: null,
      initialOppositeAnchor: null,
      isSpacePressed: false
    },

    // История для Undo / Redo
    history: [],
    historyIndex: -1,
    maxHistory: 30
  };

  // --- Ссылки на DOM элементы ---
  const dom = {
    canvas: document.getElementById('mainCanvas'),
    canvasWrapper: document.getElementById('canvasWrapper'),
    viewport: document.getElementById('canvasViewport'),
    fileInput: document.getElementById('fileInput'),
    fileInputSecondary: document.getElementById('fileInputSecondary'),
    btnLoadDemo: document.getElementById('btnLoadDemo'),
    emptyHint: document.getElementById('emptyStateHint'),
    

    // Toolbar
    btnUndo: document.getElementById('btnUndo'),
    btnRedo: document.getElementById('btnRedo'),
    canvasPresetSelect: document.getElementById('canvasPresetSelect'),
    canvasWidthInput: document.getElementById('canvasWidthInput'),
    canvasHeightInput: document.getElementById('canvasHeightInput'),
    btnApplyCanvasSize: document.getElementById('btnApplyCanvasSize'),
    btnFitCanvasToLayer: document.getElementById('btnFitCanvasToLayer'),
    canvasBgSelect: document.getElementById('canvasBgSelect'),
    canvasBgPicker: document.getElementById('canvasBgPicker'),
    btnZoomIn: document.getElementById('btnZoomIn'),
    btnZoomOut: document.getElementById('btnZoomOut'),
    btnZoomFit: document.getElementById('btnZoomFit'),
    btnZoom100: document.getElementById('btnZoom100'),
    zoomDisplay: document.getElementById('zoomLevelDisplay'),
    canvasInfoText: document.getElementById('canvasInfoText'),
    btnExportPng: document.getElementById('btnExportPng'),
    btnExportJpg: document.getElementById('btnExportJpg'),
    
    // Панель свойств
    layerPropsContent: document.getElementById('layerPropsContent'),
    noLayerSelectedNotice: document.getElementById('noLayerSelectedNotice'),
    activeLayerNameBadge: document.getElementById('activeLayerNameBadge'),
    opacityRange: document.getElementById('opacityRange'),
    opacityNumber: document.getElementById('opacityNumber'),
    blendModeSelect: document.getElementById('blendModeSelect'),
    propX: document.getElementById('propX'),
    propY: document.getElementById('propY'),
    propWidth: document.getElementById('propWidth'),
    propHeight: document.getElementById('propHeight'),
    propRotation: document.getElementById('propRotation'),
    rotationRange: document.getElementById('rotationRange'),
    btnFlipH: document.getElementById('btnFlipH'),
    btnFlipV: document.getElementById('btnFlipV'),
    btnResetRotate: document.getElementById('btnResetRotate'),
    btnCenterLayer: document.getElementById('btnCenterLayer'),
    btnFitCanvas: document.getElementById('btnFitCanvas'),
    btnResetScale: document.getElementById('btnResetScale'),
    btnDuplicateLayer: document.getElementById('btnDuplicateLayer'),
    btnDeleteLayer: document.getElementById('btnDeleteLayer'),
    
    // Хромакей (Chroma Key)
    chromaKeyEnabled: document.getElementById('chromaKeyEnabled'),
    chromaKeyControls: document.getElementById('chromaKeyControls'),
    chromaKeyColor: document.getElementById('chromaKeyColor'),
    chromaKeyHex: document.getElementById('chromaKeyHex'),
    btnChromaEyedropper: document.getElementById('btnChromaEyedropper'),
    chromaTolerance: document.getElementById('chromaTolerance'),
    chromaToleranceValue: document.getElementById('chromaToleranceValue'),
    chromaFeather: document.getElementById('chromaFeather'),
    chromaFeatherValue: document.getElementById('chromaFeatherValue'),
    chromaSpill: document.getElementById('chromaSpill'),
    chromaSpillValue: document.getElementById('chromaSpillValue'),
    
    // Слои
    layersList: document.getElementById('layersList'),
    btnLayerUp: document.getElementById('btnLayerUp'),
    btnLayerDown: document.getElementById('btnLayerDown'),
    btnClearAll: document.getElementById('btnClearAll')
  };

  const ctx = dom.canvas.getContext('2d');

  // --- Инициализация холста ---
  function initCanvas(refit = true) {
    dom.canvas.width = state.canvasWidth;
    dom.canvas.height = state.canvasHeight;
    dom.canvasWidthInput.value = state.canvasWidth;
    dom.canvasHeightInput.value = state.canvasHeight;
    updateCanvasWrapperStyle();
    if (refit) {
      fitCanvasToViewport();
    }
    render();
  }

  function updateCanvasWrapperStyle() {
    dom.canvasWrapper.style.width = `${state.canvasWidth}px`;
    dom.canvasWrapper.style.height = `${state.canvasHeight}px`;

    if (state.canvasBg === 'transparent') {
      dom.canvasWrapper.className = 'canvas-wrapper checkerboard-pattern';
      dom.canvasWrapper.style.backgroundColor = '';
    } else {
      dom.canvasWrapper.className = 'canvas-wrapper';
      const color = state.canvasBg === 'custom' ? state.customBgColor : state.canvasBg;
      dom.canvasWrapper.style.backgroundColor = color;
    }

    dom.canvasInfoText.textContent = `${state.canvasWidth} × ${state.canvasHeight} px | Слоев: ${state.layers.length}`;
  }

  // --- Управление видовым зумом и панорамированием ---
  function applyTransform() {
    dom.canvasWrapper.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    dom.zoomDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setZoom(newZoom, centerX = null, centerY = null) {
    const clampedZoom = Math.min(Math.max(newZoom, 0.05), 20);
    if (Math.abs(clampedZoom - state.zoom) < 0.001) return;

    const viewportRect = dom.viewport.getBoundingClientRect();
    const cx = centerX !== null ? centerX : viewportRect.width / 2;
    const cy = centerY !== null ? centerY : viewportRect.height / 2;

    // Зум относительно точки курсора
    const scaleFactor = clampedZoom / state.zoom;
    state.pan.x = cx - (cx - state.pan.x) * scaleFactor;
    state.pan.y = cy - (cy - state.pan.y) * scaleFactor;
    state.zoom = clampedZoom;

    applyTransform();
  }

  function fitCanvasToViewport() {
    const viewportRect = dom.viewport.getBoundingClientRect();
    const padding = 25;
    const availW = Math.max(viewportRect.width - padding * 2, 100);
    const availH = Math.max(viewportRect.height - padding * 2, 100);

    const scaleX = availW / state.canvasWidth;
    const scaleY = availH / state.canvasHeight;
    const fitScale = Math.min(scaleX, scaleY);

    state.zoom = fitScale;
    state.pan.x = (viewportRect.width - state.canvasWidth * state.zoom) / 2;
    state.pan.y = (viewportRect.height - state.canvasHeight * state.zoom) / 2;
    applyTransform();
  }

  // Преобразование координат экрана (Viewport) в координаты Холста
  function viewportToCanvas(vx, vy) {
    const rect = dom.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (vx - rect.left) * (state.canvasWidth / rect.width),
      y: (vy - rect.top) * (state.canvasHeight / rect.height)
    };
  }

  // --- Управление Историей (Undo / Redo) ---
  function saveHistory(actionName = 'Edit') {
    // Отрезаем ветку redo, если сделали действие после undo
    if (state.historyIndex < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIndex + 1);
    }

    // Сохраняем снимок состояния слоев
    const snapshot = {
      layers: state.layers.map(layer => ({
        id: layer.id,
        name: layer.name,
        image: layer.image, // сохраняем ссылку на картинку
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        originalWidth: layer.originalWidth,
        originalHeight: layer.originalHeight,
        aspectRatio: layer.aspectRatio,
        rotation: layer.rotation,
        flipX: layer.flipX,
        flipY: layer.flipY,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        visible: layer.visible,
        locked: layer.locked,
        chromaKey: layer.chromaKey ? { ...layer.chromaKey } : null
      })),
      selectedId: state.selectedId,
      canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight,
      canvasBg: state.canvasBg,
      pan: { ...state.pan }
    };

    state.history.push(snapshot);
    if (state.history.length > state.maxHistory) {
      state.history.shift();
    }
    state.historyIndex = state.history.length - 1;

    updateUndoRedoButtons();
  }

  function undo() {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      restoreSnapshot(state.history[state.historyIndex]);
    }
  }

  function redo() {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      restoreSnapshot(state.history[state.historyIndex]);
    }
  }

  function restoreSnapshot(snapshot) {
    state.layers = snapshot.layers.map(l => {
      const restored = {
        ...l,
        chromaKey: l.chromaKey ? { ...l.chromaKey } : { enabled: false, color: '#00ff00', targetR: 0, targetG: 255, targetB: 0, tolerance: 40, feather: 15, spill: 50 },
        processedCanvas: null
      };
      if (restored.chromaKey && restored.chromaKey.enabled) {
        applyChromaKeyToLayer(restored);
      }
      return restored;
    });
    state.selectedId = snapshot.selectedId;
    state.canvasWidth = snapshot.canvasWidth;
    state.canvasHeight = snapshot.canvasHeight;
    state.canvasBg = snapshot.canvasBg;
    if (snapshot.pan) {
      state.pan = { ...snapshot.pan };
    }

    dom.canvas.width = state.canvasWidth;
    dom.canvas.height = state.canvasHeight;
    dom.canvasWidthInput.value = state.canvasWidth;
    dom.canvasHeightInput.value = state.canvasHeight;
    dom.canvasBgSelect.value = state.canvasBg;

    if (dom.canvasPresetSelect) {
      const matchOpt = Array.from(dom.canvasPresetSelect.options).find(o => o.value === `${state.canvasWidth}x${state.canvasHeight}`);
      dom.canvasPresetSelect.value = matchOpt ? matchOpt.value : 'custom';
    }

    updateCanvasWrapperStyle();
    applyTransform();
    updateLayersUI();
    updatePropertiesUI();
    render();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    dom.btnUndo.disabled = state.historyIndex <= 0;
    dom.btnRedo.disabled = state.historyIndex >= state.history.length - 1;
  }

  // --- Управление слоями ---
  function getSelectedLayer() {
    if (!state.selectedId) return null;
    return state.layers.find(l => l.id === state.selectedId) || null;
  }

  function selectLayer(id) {
    state.selectedId = id;
    updateLayersUI();
    updatePropertiesUI();
    render();
  }

  function addImagesAsLayers(files) {
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    const total = files.length;

    Array.from(files).forEach((file, index) => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.naturalWidth;
          let h = img.naturalHeight;

          // Если это первое загружаемое изображение — адаптируем холст:
          // делаем его больше на 250 пикселей с каждой стороны (+500 к ширине и высоте),
          // чтобы изображение располагалось по центру и вокруг было просторное рабочее поле с ручками
          const PADDING = 250;
          if (state.layers.length === 0 && index === 0) {
            state.canvasWidth = img.naturalWidth + PADDING * 2;
            state.canvasHeight = img.naturalHeight + PADDING * 2;
            if (dom.canvasPresetSelect) dom.canvasPresetSelect.value = 'custom';
            initCanvas(true);
            w = img.naturalWidth;
            h = img.naturalHeight;
          } else if (state.layers.length === 0) {
            w = img.naturalWidth;
            h = img.naturalHeight;
          } else {
            // Вычисляем оптимальный начальный размер в пределах холста
            const maxInitialW = state.canvasWidth * 0.85;
            const maxInitialH = state.canvasHeight * 0.85;

            if (w > maxInitialW || h > maxInitialH) {
              const scale = Math.min(maxInitialW / w, maxInitialH / h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
          }

          // Небольшое смещение слоев, если загружено несколько одновременно
          const offsetX = (index % 5) * 20;
          const offsetY = (index % 5) * 20;

          const newLayer = {
            id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: file.name.replace(/\.[^/.]+$/, "") || `Слой ${state.layers.length + 1}`,
            image: img,
            x: Math.round(state.canvasWidth / 2 + offsetX),
            y: Math.round(state.canvasHeight / 2 + offsetY),
            width: w,
            height: h,
            originalWidth: img.naturalWidth,
            originalHeight: img.naturalHeight,
            aspectRatio: img.naturalWidth / img.naturalHeight,
            rotation: 0,
            flipX: false,
            flipY: false,
            opacity: 1,
            blendMode: 'source-over',
            visible: true,
            locked: false,
            chromaKey: {
              enabled: false,
              color: '#00ff00',
              targetR: 0,
              targetG: 255,
              targetB: 0,
              tolerance: 40,
              feather: 15,
              spill: 50
            },
            processedCanvas: null
          };

          state.layers.push(newLayer);
          state.selectedId = newLayer.id;

          loadedCount++;
          if (loadedCount === total) {
            saveHistory('Добавлены изображения');
            updateLayersUI();
            updatePropertiesUI();
            updateCanvasWrapperStyle();
            render();
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function deleteSelectedLayer() {
    const layer = getSelectedLayer();
    if (!layer) return;

    const idx = state.layers.findIndex(l => l.id === layer.id);
    state.layers.splice(idx, 1);

    if (state.layers.length > 0) {
      const nextIdx = Math.max(0, idx - 1);
      state.selectedId = state.layers[nextIdx].id;
    } else {
      state.selectedId = null;
    }

    saveHistory('Удален слой');
    updateLayersUI();
    updatePropertiesUI();
    updateCanvasWrapperStyle();
    render();
  }

  function duplicateSelectedLayer() {
    const layer = getSelectedLayer();
    if (!layer) return;

    const dup = {
      ...layer,
      id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: `${layer.name} (копия)`,
      x: layer.x + 25,
      y: layer.y + 25,
      chromaKey: layer.chromaKey ? { ...layer.chromaKey } : { enabled: false, color: '#00ff00', targetR: 0, targetG: 255, targetB: 0, tolerance: 40, feather: 15, spill: 50 },
      processedCanvas: null
    };

    if (dup.chromaKey && dup.chromaKey.enabled) {
      applyChromaKeyToLayer(dup);
    }

    const idx = state.layers.findIndex(l => l.id === layer.id);
    state.layers.splice(idx + 1, 0, dup);
    state.selectedId = dup.id;

    saveHistory('Дублирован слой');
    updateLayersUI();
    updatePropertiesUI();
    updateCanvasWrapperStyle();
    render();
  }

  function moveLayerOrder(direction) {
    const layer = getSelectedLayer();
    if (!layer) return;

    const idx = state.layers.findIndex(l => l.id === layer.id);
    if (direction === 'up' && idx < state.layers.length - 1) {
      const temp = state.layers[idx];
      state.layers[idx] = state.layers[idx + 1];
      state.layers[idx + 1] = temp;
    } else if (direction === 'down' && idx > 0) {
      const temp = state.layers[idx];
      state.layers[idx] = state.layers[idx - 1];
      state.layers[idx - 1] = temp;
    } else {
      return;
    }

    saveHistory('Изменен порядок слоев');
    updateLayersUI();
    render();
  }

  // --- Обработка Хромакея (Chroma Key Removal) ---
  function applyChromaKeyToLayer(layer) {
    if (!layer || !layer.image) return;
    if (!layer.chromaKey || !layer.chromaKey.enabled) {
      layer.processedCanvas = null;
      return;
    }

    const origW = layer.originalWidth || layer.image.naturalWidth || layer.width;
    const origH = layer.originalHeight || layer.image.naturalHeight || layer.height;
    if (!origW || !origH) return;

    if (!layer.processedCanvas) {
      layer.processedCanvas = document.createElement('canvas');
    }
    const procCanvas = layer.processedCanvas;
    procCanvas.width = origW;
    procCanvas.height = origH;

    const procCtx = procCanvas.getContext('2d');
    procCtx.clearRect(0, 0, origW, origH);
    procCtx.drawImage(layer.image, 0, 0, origW, origH);

    let imgData;
    try {
      imgData = procCtx.getImageData(0, 0, origW, origH);
    } catch (e) {
      console.warn('Не удалось получить пиксели изображения (CORS)', e);
      return;
    }

    const data = imgData.data;
    const len = data.length;

    const tR = layer.chromaKey.targetR;
    const tG = layer.chromaKey.targetG;
    const tB = layer.chromaKey.targetB;

    // Макс. дистанция в RGB пространстве = sqrt(255^2 * 3) ~ 441.67
    const threshold = (layer.chromaKey.tolerance / 100) * 441.67;
    const feather = (layer.chromaKey.feather / 100) * 441.67;
    const spillFactor = layer.chromaKey.spill / 100;

    const isGreenKey = tG > tR + 20 && tG > tB + 20;
    const isBlueKey = tB > tR + 20 && tB > tG + 20;

    for (let i = 0; i < len; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const dr = r - tR;
      const dg = g - tG;
      const db = b - tB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist <= threshold) {
        // Полное удаление фона
        data[i + 3] = 0;
      } else if (feather > 0 && dist < threshold + feather) {
        // Мягкий переход прозрачности на границе
        const alphaRatio = (dist - threshold) / feather;
        data[i + 3] = Math.round(a * alphaRatio);

        // Подавление зеленого/синего отблеска (Spill)
        if (spillFactor > 0) {
          if (isGreenKey) {
            const maxOther = Math.max(r, b);
            if (g > maxOther) {
              data[i + 1] = Math.round(g * (1 - spillFactor) + maxOther * spillFactor);
            }
          } else if (isBlueKey) {
            const maxOther = Math.max(r, g);
            if (b > maxOther) {
              data[i + 2] = Math.round(b * (1 - spillFactor) + maxOther * spillFactor);
            }
          }
        }
      } else if (spillFactor > 0 && dist < threshold + feather + 40) {
        // Подавление каймы на объекте рядом с контуром
        const spillDist = dist - (threshold + feather);
        const intensity = (1 - spillDist / 40) * spillFactor;

        if (isGreenKey) {
          const maxOther = Math.max(r, b);
          if (g > maxOther) {
            data[i + 1] = Math.round(g * (1 - intensity) + maxOther * intensity);
          }
        } else if (isBlueKey) {
          const maxOther = Math.max(r, g);
          if (b > maxOther) {
            data[i + 2] = Math.round(b * (1 - intensity) + maxOther * intensity);
          }
        }
      }
    }

    procCtx.putImageData(imgData, 0, 0);
  }

  // --- Отрисовка холста (Canvas Render) ---
  function render() {
    ctx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);

    // 1. Отрисовка цвета фона (если выбран не прозрачный)
    if (state.canvasBg !== 'transparent') {
      const color = state.canvasBg === 'custom' ? state.customBgColor : state.canvasBg;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, state.canvasWidth, state.canvasHeight);
    }

    // Показываем/скрываем подсказку пустого экрана
    dom.emptyHint.style.display = state.layers.length === 0 ? 'flex' : 'none';

    // 2. Отрисовка всех видимых слоев от нижнего к верхнему
    state.layers.forEach(layer => {
      if (!layer.visible) return;

      ctx.save();

      // Центрируем систему координат в точке центра слоя
      ctx.translate(layer.x, layer.y);
      ctx.rotate(layer.rotation * DEG2RAD);
      ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);

      // Прозрачность и режим смешивания
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      ctx.globalCompositeOperation = layer.blendMode || 'source-over';

      // Отрисовка изображения (с учетом хромакея, если активен)
      const drawX = -layer.width / 2;
      const drawY = -layer.height / 2;
      const sourceImg = (layer.chromaKey && layer.chromaKey.enabled && layer.processedCanvas) ? layer.processedCanvas : layer.image;

      try {
        ctx.drawImage(sourceImg, drawX, drawY, layer.width, layer.height);
      } catch (err) {
        console.error('Ошибка отрисовки слоя', err);
      }

      ctx.restore();
    });

    // 3. Отрисовка рамки выделения и маркеров трансформации для активного слоя
    const selected = getSelectedLayer();
    if (selected && selected.visible) {
      drawLayerTransformControls(selected);
    }
  }

  // Отрисовка рамки и контроллеров вокруг выбранного слоя
  function drawLayerTransformControls(layer) {
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rotation * DEG2RAD);

    const hw = layer.width / 2;
    const hh = layer.height / 2;

    // Рамка (Bounding box)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.8 / state.zoom;
    ctx.strokeRect(-hw, -hh, layer.width, layer.height);

    // Если слой заблокирован, рисуем только рамку с замочком
    if (layer.locked) {
      ctx.restore();
      return;
    }

    // Линия и ручка вращения (Rotate handle)
    const rotDist = 28 / state.zoom;
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, -hh - rotDist);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.stroke();

    // Круглая ручка вращения
    const handleRadius = 7 / state.zoom;
    ctx.beginPath();
    ctx.arc(0, -hh - rotDist, handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / state.zoom;
    ctx.stroke();

    // 8 маркеров изменения размера (Resize handles)
    const handles = [
      { x: -hw, y: -hh },  // nw
      { x: 0,   y: -hh },  // n
      { x: hw,  y: -hh },  // ne
      { x: hw,  y: 0 },    // e
      { x: hw,  y: hh },   // se
      { x: 0,   y: hh },   // s
      { x: -hw, y: hh },   // sw
      { x: -hw, y: 0 }     // w
    ];

    const hSize = 10 / state.zoom;
    const halfHSize = hSize / 2;

    handles.forEach(h => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 / state.zoom;
      ctx.fillRect(h.x - halfHSize, h.y - halfHSize, hSize, hSize);
      ctx.strokeRect(h.x - halfHSize, h.y - halfHSize, hSize, hSize);
    });

    ctx.restore();
  }

  // --- Преобразования координат слоя ---
  function canvasToLocal(layer, cx, cy) {
    const dx = cx - layer.x;
    const dy = cy - layer.y;
    return rotatePoint(dx, dy, -layer.rotation * DEG2RAD);
  }

  function localToCanvas(layer, lx, ly) {
    const rot = rotatePoint(lx, ly, layer.rotation * DEG2RAD);
    return {
      x: layer.x + rot.x,
      y: layer.y + rot.y
    };
  }

  // --- Проверка попадания курсора (Hit-Testing) ---
  function hitTest(canvasX, canvasY) {
    const selected = getSelectedLayer();
    // Допуск клика в экранных пикселях (комфортные 12-14px на экране для легкого захвата)
    const hitTolerance = Math.max(12 / state.zoom, 8);

    // 1. Сначала проверяем маркеры и границы активного выделенного слоя
    if (selected && selected.visible && !selected.locked) {
      const local = canvasToLocal(selected, canvasX, canvasY);
      const hw = selected.width / 2;
      const hh = selected.height / 2;

      // 1a. Маркер вращения сверху
      const rotDist = 28 / state.zoom;
      const rotHandlePos = { x: 0, y: -hh - rotDist };
      if (Math.hypot(local.x - rotHandlePos.x, local.y - rotHandlePos.y) <= hitTolerance + 2) {
        return { type: 'rotate', handle: 'rot', layer: selected };
      }

      // 1b. Угловые маркеры (Corners)
      const corners = [
        { handle: 'nw', x: -hw, y: -hh },
        { handle: 'ne', x: hw,  y: -hh },
        { handle: 'se', x: hw,  y: hh },
        { handle: 'sw', x: -hw, y: hh }
      ];

      for (const c of corners) {
        if (Math.hypot(local.x - c.x, local.y - c.y) <= hitTolerance) {
          return { type: 'resize', handle: c.handle, layer: selected };
        }
      }

      // 1c. Грани и средние маркеры (Edges & Middle handles)
      // Верхняя грань (Top Edge / 'n')
      if (Math.abs(local.y - (-hh)) <= hitTolerance && local.x >= -hw - hitTolerance && local.x <= hw + hitTolerance) {
        return { type: 'resize', handle: 'n', layer: selected };
      }
      // Нижняя грань (Bottom Edge / 's')
      if (Math.abs(local.y - hh) <= hitTolerance && local.x >= -hw - hitTolerance && local.x <= hw + hitTolerance) {
        return { type: 'resize', handle: 's', layer: selected };
      }
      // Левая грань (Left Edge / 'w')
      if (Math.abs(local.x - (-hw)) <= hitTolerance && local.y >= -hh - hitTolerance && local.y <= hh + hitTolerance) {
        return { type: 'resize', handle: 'w', layer: selected };
      }
      // Правая грань (Right Edge / 'e')
      if (Math.abs(local.x - hw) <= hitTolerance && local.y >= -hh - hitTolerance && local.y <= hh + hitTolerance) {
        return { type: 'resize', handle: 'e', layer: selected };
      }
    }

    // 2. Проверяем попадание в тело слоев (сверху вниз)
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];
      if (!layer.visible) continue;

      const local = canvasToLocal(layer, canvasX, canvasY);
      const hw = layer.width / 2;
      const hh = layer.height / 2;

      if (Math.abs(local.x) <= hw && Math.abs(local.y) <= hh) {
        return { type: 'layer-body', layer: layer };
      }
    }

    return null;
  }

  // --- Обработчики взаимодействия с мышью/тачем ---
  dom.viewport.addEventListener('mousedown', (e) => {
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }

    // Панорамирование по средней кнопке мыши или с зажатым пробелом
    if (e.button === 1 || state.interaction.isSpacePressed) {
      e.preventDefault();
      state.interaction.type = 'pan';
      state.interaction.startX = e.clientX;
      state.interaction.startY = e.clientY;
      state.interaction.startPanX = state.pan.x;
      state.interaction.startPanY = state.pan.y;
      dom.viewport.classList.add('panning');
      return;
    }

    if (e.button !== 0) return; // только левая кнопка

    const canvasPos = viewportToCanvas(e.clientX, e.clientY);
    const hit = hitTest(canvasPos.x, canvasPos.y);

    if (hit) {
      if (hit.type === 'rotate') {
        const layer = hit.layer;
        state.interaction.type = 'rotate';
        state.interaction.startX = canvasPos.x;
        state.interaction.startY = canvasPos.y;
        state.interaction.initialLayerState = { ...layer };
        dom.viewport.style.cursor = 'crosshair';
      } else if (hit.type === 'resize') {
        const layer = hit.layer;
        state.interaction.type = 'resize';
        state.interaction.handle = hit.handle;
        state.interaction.startX = canvasPos.x;
        state.interaction.startY = canvasPos.y;
        state.interaction.initialLayerState = { ...layer };
        state.interaction.startLocalMouse = canvasToLocal(layer, canvasPos.x, canvasPos.y);
        dom.viewport.style.cursor = getHandleCursor(hit.handle, layer.rotation);
      } else if (hit.type === 'layer-body') {
        const layer = hit.layer;
        selectLayer(layer.id);
        if (!layer.locked) {
          state.interaction.type = 'move';
          state.interaction.startX = canvasPos.x;
          state.interaction.startY = canvasPos.y;
          state.interaction.initialLayerState = { ...layer };
          dom.viewport.style.cursor = 'move';
        }
      }
    } else {
      // Клик по пустому холсту -> снять выделение
      selectLayer(null);
    }
  });

  window.addEventListener('mousemove', (e) => {
    const inter = state.interaction;

    // 0. Изменение размера холста интерактивно ручками со всех 4 углов и 4 сторон
    if (inter.type === 'canvas-resize') {
      const dx = (e.clientX - inter.startX) / state.zoom;
      const dy = (e.clientY - inter.startY) / state.zoom;
      const h = inter.canvasHandle;

      let newW = inter.startW;
      let newH = inter.startH;
      let deltaW = 0;
      let deltaH = 0;

      // Горизонталь: правые ручки или левые ручки
      if (['e', 'se', 'ne'].includes(h)) {
        newW = Math.max(100, Math.min(8000, Math.round(inter.startW + dx)));
      } else if (['w', 'sw', 'nw'].includes(h)) {
        newW = Math.max(100, Math.min(8000, Math.round(inter.startW - dx)));
        deltaW = newW - inter.startW;
      }

      // Вертикаль: нижние ручки или верхние ручки
      if (['s', 'se', 'sw'].includes(h)) {
        newH = Math.max(100, Math.min(8000, Math.round(inter.startH + dy)));
      } else if (['n', 'nw', 'ne'].includes(h)) {
        newH = Math.max(100, Math.min(8000, Math.round(inter.startH - dy)));
        deltaH = newH - inter.startH;
      }

      state.canvasWidth = newW;
      state.canvasHeight = newH;
      dom.canvas.width = newW;
      dom.canvas.height = newH;
      dom.canvasWidthInput.value = newW;
      dom.canvasHeightInput.value = newH;
      if (dom.canvasPresetSelect) dom.canvasPresetSelect.value = 'custom';

      // При растягивании сверху/слева компенсируем смещение панорамирования
      // и сдвигаем координаты слоев, чтобы их визуальное положение на экране оставалось на месте
      if (inter.startPanX !== undefined) {
        state.pan.x = inter.startPanX - deltaW * state.zoom;
        state.pan.y = inter.startPanY - deltaH * state.zoom;
        applyTransform();
      }

      if (inter.layerStartPositions) {
        inter.layerStartPositions.forEach(item => {
          const layer = state.layers.find(l => l.id === item.id);
          if (layer) {
            layer.x = Math.round(item.x + deltaW);
            layer.y = Math.round(item.y + deltaH);
          }
        });
      }

      updateCanvasWrapperStyle();
      updatePropertiesUI(false);
      render();
      return;
    }

    // 1. Панорамирование экрана
    if (inter.type === 'pan') {
      state.pan.x = inter.startPanX + (e.clientX - inter.startX);
      state.pan.y = inter.startPanY + (e.clientY - inter.startY);
      applyTransform();
      return;
    }

    const canvasPos = viewportToCanvas(e.clientX, e.clientY);
    const selected = getSelectedLayer();

    // 2. Перемещение слоя
    if (inter.type === 'move' && selected && !selected.locked) {
      const dx = canvasPos.x - inter.startX;
      const dy = canvasPos.y - inter.startY;
      selected.x = Math.round(inter.initialLayerState.x + dx);
      selected.y = Math.round(inter.initialLayerState.y + dy);
      updatePropertiesUI(false);
      render();
      return;
    }

    // 3. Вращение слоя
    if (inter.type === 'rotate' && selected && !selected.locked) {
      const dx = canvasPos.x - selected.x;
      const dy = canvasPos.y - selected.y;
      let angle = Math.atan2(dy, dx) * RAD2DEG + 90;

      // С зажатым Shift — шаг 15 градусов
      if (e.shiftKey) {
        angle = Math.round(angle / 15) * 15;
      }

      // Нормализуем в диапазон -180 .. 180
      while (angle > 180) angle -= 360;
      while (angle < -180) angle += 360;

      selected.rotation = Math.round(angle);
      updatePropertiesUI(false);
      render();
      return;
    }

    // 4. Трансформация размера (Resize)
    if (inter.type === 'resize' && selected && !selected.locked) {
      handleResizeInteraction(canvasPos, e.shiftKey);
      updatePropertiesUI(false);
      render();
      return;
    }

    // 5. Обновление курсора мыши при наведении (hover)
    if (inter.type === 'none') {
      if (inter.isSpacePressed) {
        dom.viewport.style.cursor = 'grab';
      } else {
        const hoverHit = hitTest(canvasPos.x, canvasPos.y);
        if (hoverHit) {
          if (hoverHit.type === 'rotate') {
            dom.viewport.style.cursor = 'grab';
          } else if (hoverHit.type === 'resize') {
            dom.viewport.style.cursor = getHandleCursor(hoverHit.handle, selected ? selected.rotation : 0);
          } else if (hoverHit.type === 'layer-body') {
            dom.viewport.style.cursor = hoverHit.layer.locked ? 'not-allowed' : 'move';
          }
        } else {
          dom.viewport.style.cursor = 'default';
        }
      }
    }
  });

  function handleResizeInteraction(canvasPos, isShiftPressed) {
    const inter = state.interaction;
    const init = inter.initialLayerState;
    const selected = getSelectedLayer();
    if (!selected) return;
    const handle = inter.handle;

    const W0 = init.width;
    const H0 = init.height;
    let left = -W0 / 2;
    let right = W0 / 2;
    let top = -H0 / 2;
    let bottom = H0 / 2;

    const curLocal = canvasToLocal(init, canvasPos.x, canvasPos.y);
    const startLocal = inter.startLocalMouse;
    const dLx = curLocal.x - startLocal.x;
    const dLy = curLocal.y - startLocal.y;

    const isCorner = ['nw', 'ne', 'se', 'sw'].includes(handle);
    const preserveAspect = isShiftPressed || isCorner;

    if (handle === 'e') {
      right = Math.max(left + 10, right + dLx);
    } else if (handle === 'w') {
      left = Math.min(right - 10, left + dLx);
    } else if (handle === 's') {
      bottom = Math.max(top + 10, bottom + dLy);
    } else if (handle === 'n') {
      top = Math.min(bottom - 10, top + dLy);
    } else if (handle === 'se') {
      let newR = right + dLx;
      let newB = bottom + dLy;
      if (preserveAspect) {
        const scale = Math.max((newR - left) / W0, (newB - top) / H0, 0.05);
        newR = left + W0 * scale;
        newB = top + H0 * scale;
      }
      right = Math.max(left + 10, newR);
      bottom = Math.max(top + 10, newB);
    } else if (handle === 'nw') {
      let newL = left + dLx;
      let newT = top + dLy;
      if (preserveAspect) {
        const scale = Math.max((right - newL) / W0, (bottom - newT) / H0, 0.05);
        newL = right - W0 * scale;
        newT = bottom - H0 * scale;
      }
      left = Math.min(right - 10, newL);
      top = Math.min(bottom - 10, newT);
    } else if (handle === 'ne') {
      let newR = right + dLx;
      let newT = top + dLy;
      if (preserveAspect) {
        const scale = Math.max((newR - left) / W0, (bottom - newT) / H0, 0.05);
        newR = left + W0 * scale;
        newT = bottom - H0 * scale;
      }
      right = Math.max(left + 10, newR);
      top = Math.min(bottom - 10, newT);
    } else if (handle === 'sw') {
      let newL = left + dLx;
      let newB = bottom + dLy;
      if (preserveAspect) {
        const scale = Math.max((right - newL) / W0, (bottom - newT) / H0, 0.05);
        newL = right - W0 * scale;
        newB = top + H0 * scale;
      }
      left = Math.min(right - 10, newL);
      bottom = Math.max(top + 10, newB);
    }

    const newW = Math.round(right - left);
    const newH = Math.round(bottom - top);
    const localCenterX = (left + right) / 2;
    const localCenterY = (top + bottom) / 2;
    const newWorldCenter = localToCanvas(init, localCenterX, localCenterY);

    selected.width = newW;
    selected.height = newH;
    selected.x = Math.round(newWorldCenter.x);
    selected.y = Math.round(newWorldCenter.y);
  }

  window.addEventListener('mouseup', () => {
    if (state.interaction.type !== 'none') {
      if (['move', 'resize', 'rotate'].includes(state.interaction.type)) {
        saveHistory('Трансформация слоя');
      } else if (state.interaction.type === 'canvas-resize') {
        saveHistory('Изменен размер холста');
      }
      state.interaction.type = 'none';
      state.interaction.handle = null;
      dom.viewport.classList.remove('panning');
      dom.viewport.style.cursor = 'default';
    }
  });

  // Зум колесиком мыши
  dom.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom(state.zoom * zoomFactor, e.clientX, e.clientY);
  }, { passive: false });

  // Клавиатурные сокращения
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTextInput = active && (
      active.tagName === 'TEXTAREA' ||
      (active.tagName === 'INPUT' && ['text', 'search'].includes(active.type))
    );

    // 1. Undo / Redo / Duplicate (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+D)
    // Надежно работает при любой раскладке клавиатуры (RU / EN / e.code / e.key)
    if (e.ctrlKey || e.metaKey) {
      const isZ = e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я';
      const isY = e.code === 'KeyY' || e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н';
      const isD = e.code === 'KeyD' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В';

      if (isZ) {
        if (!isTextInput) {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
      } else if (isY) {
        if (!isTextInput) {
          e.preventDefault();
          redo();
          return;
        }
      } else if (isD) {
        if (!isTextInput) {
          e.preventDefault();
          duplicateSelectedLayer();
          return;
        }
      }
    }

    // Если сейчас редактируется текст в текстовом поле input/textarea:
    // даем пользователю вводить текст, Enter/Escape снимают фокус
    if (isTextInput) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        active.blur();
      }
      return;
    }

    // 2. Escape — снять выделение со слоя
    if (e.key === 'Escape') {
      if (active && active.blur) active.blur();
      selectLayer(null);
      return;
    }

    // 3. Пробел для панорамирования холста
    if (e.code === 'Space' && !state.interaction.isSpacePressed) {
      state.interaction.isSpacePressed = true;
      dom.viewport.style.cursor = 'grab';
    }

    // 4. Удаление (Delete / Backspace)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelectedLayer();
      return;
    }

    // 5. Стрелочки для перемещения выделенного слоя (по 1px или 10px с Shift)
    const selected = getSelectedLayer();
    if (selected && !selected.locked && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowUp') selected.y -= step;
      if (e.key === 'ArrowDown') selected.y += step;
      if (e.key === 'ArrowLeft') selected.x -= step;
      if (e.key === 'ArrowRight') selected.x += step;
      updatePropertiesUI(false);
      render();
      saveHistory('Сдвиг слоя');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      state.interaction.isSpacePressed = false;
      dom.viewport.style.cursor = 'default';
    }
  });

  // Drag & Drop файлов на холст
  ['dragenter', 'dragover'].forEach(eventName => {
    dom.viewport.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.viewport.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dom.viewport.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dom.viewport.classList.remove('drag-over');
    });
  });

  dom.viewport.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      addImagesAsLayers(e.dataTransfer.files);
    }
  });

  // --- Обновление UI Свойств выбранного слоя ---
  function updatePropertiesUI(full = true) {
    const layer = getSelectedLayer();
    const chromaNotice = document.getElementById('chromaNoLayerNotice');
    const chromaBadge = document.getElementById('chromaStatusBadge');

    if (!layer) {
      dom.layerPropsContent.style.display = 'none';
      dom.noLayerSelectedNotice.style.display = 'block';
      dom.activeLayerNameBadge.textContent = 'Слой не выбран';
      if (chromaNotice) chromaNotice.style.display = 'block';
      if (dom.chromaKeyControls) dom.chromaKeyControls.style.display = 'none';
      if (dom.chromaKeyEnabled) {
        dom.chromaKeyEnabled.checked = false;
        dom.chromaKeyEnabled.disabled = true;
      }
      if (chromaBadge) chromaBadge.textContent = 'Выкл';
      return;
    }

    dom.layerPropsContent.style.display = 'flex';
    dom.noLayerSelectedNotice.style.display = 'none';
    dom.activeLayerNameBadge.textContent = layer.name;
    if (chromaNotice) chromaNotice.style.display = 'none';
    if (dom.chromaKeyEnabled) dom.chromaKeyEnabled.disabled = false;

    // Значения
    dom.opacityRange.value = Math.round(layer.opacity * 100);
    dom.opacityNumber.value = Math.round(layer.opacity * 100);
    dom.blendModeSelect.value = layer.blendMode || 'source-over';
    dom.propX.value = layer.x;
    dom.propY.value = layer.y;
    dom.propWidth.value = layer.width;
    dom.propHeight.value = layer.height;
    dom.propRotation.value = layer.rotation;
    dom.rotationRange.value = layer.rotation;

    // Контроллеры хромакея
    const ck = layer.chromaKey || { enabled: false, color: '#00ff00', tolerance: 40, feather: 15, spill: 50 };
    dom.chromaKeyEnabled.checked = !!ck.enabled;
    dom.chromaKeyControls.style.display = ck.enabled ? 'flex' : 'none';
    dom.chromaKeyColor.value = ck.color;
    dom.chromaKeyHex.textContent = ck.color.toUpperCase();
    dom.chromaTolerance.value = ck.tolerance;
    dom.chromaToleranceValue.textContent = `${ck.tolerance}%`;
    dom.chromaFeather.value = ck.feather;
    dom.chromaFeatherValue.textContent = `${ck.feather}%`;
    dom.chromaSpill.value = ck.spill;
    dom.chromaSpillValue.textContent = `${ck.spill}%`;
    if (chromaBadge) chromaBadge.textContent = ck.enabled ? 'Вкл' : 'Выкл';
  }

  // --- Обновление Списка слоев (UI) ---
  function updateLayersUI() {
    dom.layersList.innerHTML = '';

    // Отображаем слои сверху вниз (от высшего индекса к нулевому)
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];
      const item = document.createElement('div');
      item.className = `layer-item ${layer.id === state.selectedId ? 'active' : ''}`;
      item.draggable = true;
      item.dataset.layerId = layer.id;

      // Миниатюра
      const thumbBox = document.createElement('div');
      thumbBox.className = 'layer-thumb-container';
      const img = document.createElement('img');
      img.className = 'layer-thumb';
      const thumbSrc = (layer.chromaKey && layer.chromaKey.enabled && layer.processedCanvas) ? layer.processedCanvas.toDataURL() : layer.image.src;
      img.src = thumbSrc;
      thumbBox.appendChild(img);

      // Описание и переименование
      const details = document.createElement('div');
      details.className = 'layer-details';

      const titleInput = document.createElement('input');
      titleInput.className = 'layer-title-input';
      titleInput.value = layer.name;
      titleInput.title = 'Двойной клик для переименования';
      titleInput.addEventListener('change', () => {
        layer.name = titleInput.value.trim() || 'Без имени';
        saveHistory('Переименован слой');
        updatePropertiesUI();
      });

      const meta = document.createElement('div');
      meta.className = 'layer-meta';
      meta.textContent = `${layer.width} × ${layer.height} px • ${Math.round(layer.opacity * 100)}%`;

      details.appendChild(titleInput);
      details.appendChild(meta);

      // Кнопки быстрых действий (видимость и замок)
      const actions = document.createElement('div');
      actions.className = 'layer-quick-actions';

      // Кнопка видимости (глаз)
      const btnVis = document.createElement('button');
      btnVis.className = `layer-btn-icon ${!layer.visible ? 'hidden-state' : ''}`;
      btnVis.title = layer.visible ? 'Скрыть слой' : 'Показать слой';
      btnVis.innerHTML = layer.visible ? 
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>` :
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      btnVis.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.visible = !layer.visible;
        saveHistory(layer.visible ? 'Показан слой' : 'Скрыт слой');
        updateLayersUI();
        render();
      });

      // Кнопка блокировки (замок)
      const btnLock = document.createElement('button');
      btnLock.className = `layer-btn-icon ${layer.locked ? 'locked-state' : ''}`;
      btnLock.title = layer.locked ? 'Разблокировать слой' : 'Заблокировать слой';
      btnLock.innerHTML = layer.locked ?
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` :
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
      btnLock.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.locked = !layer.locked;
        saveHistory(layer.locked ? 'Заблокирован слой' : 'Разблокирован слой');
        updateLayersUI();
        render();
      });

      actions.appendChild(btnVis);
      actions.appendChild(btnLock);

      item.appendChild(thumbBox);
      item.appendChild(details);
      item.appendChild(actions);

      item.addEventListener('click', () => {
        selectLayer(layer.id);
      });

      // Drag and Drop для перестановки слоев в списке
      setupLayerDragAndDrop(item, layer.id);

      dom.layersList.appendChild(item);
    }
  }

  function setupLayerDragAndDrop(item, layerId) {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', layerId);
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.style.borderTop = '2px solid var(--accent-primary)';
    });

    item.addEventListener('dragleave', () => {
      item.style.borderTop = '';
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.style.borderTop = '';
      const sourceId = e.dataTransfer.getData('text/plain');
      if (sourceId && sourceId !== layerId) {
        const fromIdx = state.layers.findIndex(l => l.id === sourceId);
        const toIdx = state.layers.findIndex(l => l.id === layerId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [moved] = state.layers.splice(fromIdx, 1);
          state.layers.splice(toIdx, 0, moved);
          saveHistory('Переставлен слой');
          updateLayersUI();
          render();
        }
      }
    });
  }

  // --- Привязка контроллеров панели свойств ---
  function bindPropertyEvents() {
    // Прозрачность (Opacity)
    const handleOpacityChange = (val) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.opacity = Math.max(0, Math.min(100, val)) / 100;
      dom.opacityRange.value = Math.round(layer.opacity * 100);
      dom.opacityNumber.value = Math.round(layer.opacity * 100);
      render();
    };

    dom.opacityRange.addEventListener('input', (e) => handleOpacityChange(Number(e.target.value)));
    dom.opacityRange.addEventListener('change', () => saveHistory('Изменена прозрачность'));
    dom.opacityNumber.addEventListener('input', (e) => handleOpacityChange(Number(e.target.value)));
    dom.opacityNumber.addEventListener('change', () => saveHistory('Изменена прозрачность'));

    // Режим наложения (Blend mode)
    dom.blendModeSelect.addEventListener('change', (e) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.blendMode = e.target.value;
      saveHistory('Изменен режим смешивания');
      render();
    });

    // Хромакей (Chroma Key)
    const setChromaColor = (hex) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      if (!layer.chromaKey) {
        layer.chromaKey = { enabled: true, color: hex, tolerance: 40, feather: 15, spill: 50 };
      }
      layer.chromaKey.color = hex;
      const rgb = hexToRgb(hex);
      layer.chromaKey.targetR = rgb.r;
      layer.chromaKey.targetG = rgb.g;
      layer.chromaKey.targetB = rgb.b;
      dom.chromaKeyColor.value = hex;
      dom.chromaKeyHex.textContent = hex.toUpperCase();
      if (layer.chromaKey.enabled) {
        applyChromaKeyToLayer(layer);
        render();
        updateLayersUI();
      }
    };

    dom.chromaKeyEnabled.addEventListener('change', (e) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      if (!layer.chromaKey) {
        layer.chromaKey = { enabled: false, color: '#00ff00', tolerance: 40, feather: 15, spill: 50 };
        const rgb = hexToRgb('#00ff00');
        layer.chromaKey.targetR = rgb.r;
        layer.chromaKey.targetG = rgb.g;
        layer.chromaKey.targetB = rgb.b;
      }
      layer.chromaKey.enabled = e.target.checked;
      dom.chromaKeyControls.style.display = layer.chromaKey.enabled ? 'flex' : 'none';
      const chromaBadge = document.getElementById('chromaStatusBadge');
      if (chromaBadge) chromaBadge.textContent = layer.chromaKey.enabled ? 'Вкл' : 'Выкл';
      applyChromaKeyToLayer(layer);
      saveHistory(layer.chromaKey.enabled ? 'Включен хромакей' : 'Выключен хромакей');
      render();
      updateLayersUI();
    });

    dom.chromaKeyColor.addEventListener('input', (e) => {
      setChromaColor(e.target.value);
    });
    dom.chromaKeyColor.addEventListener('change', () => {
      saveHistory('Изменен цвет хромакея');
    });

    // Пресеты цветов
    document.querySelectorAll('.preset-color-dot').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        if (color) {
          setChromaColor(color);
          saveHistory('Выбран пресет хромакея');
        }
      });
    });

    // Порог (Tolerance)
    dom.chromaTolerance.addEventListener('input', (e) => {
      const layer = getSelectedLayer();
      if (!layer || !layer.chromaKey) return;
      layer.chromaKey.tolerance = Number(e.target.value);
      dom.chromaToleranceValue.textContent = `${e.target.value}%`;
      if (layer.chromaKey.enabled) {
        applyChromaKeyToLayer(layer);
        render();
      }
    });
    dom.chromaTolerance.addEventListener('change', () => {
      saveHistory('Изменен порог хромакея');
      updateLayersUI();
    });

    // Мягкость краев (Feather)
    dom.chromaFeather.addEventListener('input', (e) => {
      const layer = getSelectedLayer();
      if (!layer || !layer.chromaKey) return;
      layer.chromaKey.feather = Number(e.target.value);
      dom.chromaFeatherValue.textContent = `${e.target.value}%`;
      if (layer.chromaKey.enabled) {
        applyChromaKeyToLayer(layer);
        render();
      }
    });
    dom.chromaFeather.addEventListener('change', () => {
      saveHistory('Изменено сглаживание хромакея');
      updateLayersUI();
    });

    // Подавление каймы (Spill reduction)
    dom.chromaSpill.addEventListener('input', (e) => {
      const layer = getSelectedLayer();
      if (!layer || !layer.chromaKey) return;
      layer.chromaKey.spill = Number(e.target.value);
      dom.chromaSpillValue.textContent = `${e.target.value}%`;
      if (layer.chromaKey.enabled) {
        applyChromaKeyToLayer(layer);
        render();
      }
    });
    dom.chromaSpill.addEventListener('change', () => {
      saveHistory('Изменено подавление каймы');
      updateLayersUI();
    });

    // Пипетка
    dom.btnChromaEyedropper.addEventListener('click', async () => {
      const layer = getSelectedLayer();
      if (!layer) return;

      if (window.EyeDropper) {
        try {
          const eyeDropper = new EyeDropper();
          const result = await eyeDropper.open();
          if (result && result.sRGBHex) {
            setChromaColor(result.sRGBHex);
            saveHistory('Выбран цвет хромакея пипеткой');
          }
        } catch (err) {
          // Отмена
        }
      } else {
        dom.viewport.style.cursor = 'crosshair';
        const onCanvasPick = (e) => {
          dom.viewport.removeEventListener('click', onCanvasPick);
          dom.viewport.style.cursor = 'default';
          const pos = viewportToCanvas(e.clientX, e.clientY);
          const p = ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
          const hex = rgbToHex(p[0], p[1], p[2]);
          setChromaColor(hex);
          saveHistory('Выбран цвет хромакея пипеткой');
        };
        setTimeout(() => {
          dom.viewport.addEventListener('click', onCanvasPick, { once: true });
        }, 50);
      }
    });

    // Позиция X, Y
    dom.propX.addEventListener('change', (e) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.x = Number(e.target.value) || 0;
      saveHistory('Изменен X');
      render();
    });

    dom.propY.addEventListener('change', (e) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.y = Number(e.target.value) || 0;
      saveHistory('Изменен Y');
      render();
    });

    // Размеры Ширина, Высота
    dom.propWidth.addEventListener('change', (e) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      const w = Math.max(10, Number(e.target.value) || 10);
      layer.width = w;
      saveHistory('Изменена ширина');
      render();
    });

    dom.propHeight.addEventListener('change', (e) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      const h = Math.max(10, Number(e.target.value) || 10);
      layer.height = h;
      saveHistory('Изменена высота');
      render();
    });

    // Поворот
    const handleRotChange = (val) => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.rotation = Number(val) || 0;
      dom.propRotation.value = layer.rotation;
      dom.rotationRange.value = layer.rotation;
      render();
    };

    dom.rotationRange.addEventListener('input', (e) => handleRotChange(e.target.value));
    dom.rotationRange.addEventListener('change', () => saveHistory('Изменен поворот'));
    dom.propRotation.addEventListener('change', (e) => {
      handleRotChange(e.target.value);
      saveHistory('Изменен поворот');
    });

    // Флип по горизонтали / вертикали
    dom.btnFlipH.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.flipX = !layer.flipX;
      saveHistory('Отражение по горизонтали');
      render();
    });

    dom.btnFlipV.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.flipY = !layer.flipY;
      saveHistory('Отражение по вертикали');
      render();
    });

    // Сбросить поворот
    dom.btnResetRotate.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.rotation = 0;
      saveHistory('Сброшен угол');
      updatePropertiesUI();
      render();
    });

    // В центр
    dom.btnCenterLayer.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.x = Math.round(state.canvasWidth / 2);
      layer.y = Math.round(state.canvasHeight / 2);
      saveHistory('Отцентрован слой');
      updatePropertiesUI();
      render();
    });

    // По холсту (Fit)
    dom.btnFitCanvas.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      const scale = Math.min(state.canvasWidth / layer.originalWidth, state.canvasHeight / layer.originalHeight);
      layer.width = Math.round(layer.originalWidth * scale);
      layer.height = Math.round(layer.originalHeight * scale);
      layer.x = Math.round(state.canvasWidth / 2);
      layer.y = Math.round(state.canvasHeight / 2);
      layer.rotation = 0;
      saveHistory('Подогнан под холст');
      updatePropertiesUI();
      render();
    });

    // Исходный размер (1:1)
    dom.btnResetScale.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.width = layer.originalWidth;
      layer.height = layer.originalHeight;
      saveHistory('Сброшен масштаб слоя');
      updatePropertiesUI();
      render();
    });

    // Дублировать / Удалить
    dom.btnDuplicateLayer.addEventListener('click', duplicateSelectedLayer);
    dom.btnDeleteLayer.addEventListener('click', deleteSelectedLayer);

    // Управление порядком слоев
    dom.btnLayerUp.addEventListener('click', () => moveLayerOrder('up'));
    dom.btnLayerDown.addEventListener('click', () => moveLayerOrder('down'));

    // Очистить все слои
    dom.btnClearAll.addEventListener('click', () => {
      if (state.layers.length === 0) return;
      if (confirm('Вы действительно хотите удалить все слои?')) {
        state.layers = [];
        state.selectedId = null;
        saveHistory('Очищены все слои');
        updateLayersUI();
        updatePropertiesUI();
        updateCanvasWrapperStyle();
        render();
      }
    });
  }

  // --- Привязка контроллеров Toolbar ---
  function bindToolbarEvents() {
    // Загрузка файлов
    const onFileInput = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addImagesAsLayers(e.target.files);
        e.target.value = ''; // сброс для повторного выбора того же файла
      }
    };
    dom.fileInput.addEventListener('change', onFileInput);
    dom.fileInputSecondary.addEventListener('change', onFileInput);

    if (dom.btnLoadDemo) {
      dom.btnLoadDemo.addEventListener('click', loadDemoSamples);
    }

    // Undo / Redo
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);

    // Пресеты размеров холста
    if (dom.canvasPresetSelect) {
      dom.canvasPresetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') return;
        const [w, h] = val.split('x').map(Number);
        if (w && h) {
          state.canvasWidth = w;
          state.canvasHeight = h;
          initCanvas(true);
          saveHistory(`Размер холста: ${val}`);
        }
      });
    }

    // Применить размер кнопкой ОК
    dom.btnApplyCanvasSize.addEventListener('click', () => {
      const w = parseInt(dom.canvasWidthInput.value, 10);
      const h = parseInt(dom.canvasHeightInput.value, 10);
      if (w >= 100 && h >= 100 && w <= 8000 && h <= 8000) {
        state.canvasWidth = w;
        state.canvasHeight = h;
        if (dom.canvasPresetSelect) dom.canvasPresetSelect.value = 'custom';
        initCanvas(true);
        saveHistory('Изменен размер холста');
      }
    });

    // Подогнать холст под выбранный слой
    if (dom.btnFitCanvasToLayer) {
      dom.btnFitCanvasToLayer.addEventListener('click', () => {
        const layer = getSelectedLayer();
        if (!layer) {
          alert('Сначала выберите слой на холсте!');
          return;
        }
        state.canvasWidth = layer.width;
        state.canvasHeight = layer.height;
        layer.x = Math.round(layer.width / 2);
        layer.y = Math.round(layer.height / 2);
        if (dom.canvasPresetSelect) dom.canvasPresetSelect.value = 'custom';
        initCanvas(true);
        saveHistory('Холст подогнан под слой');
      });
    }

    // Фон холста
    dom.canvasBgSelect.addEventListener('change', (e) => {
      state.canvasBg = e.target.value;
      if (state.canvasBg === 'custom') {
        dom.canvasBgPicker.style.display = 'inline-block';
        state.customBgColor = dom.canvasBgPicker.value;
      } else {
        dom.canvasBgPicker.style.display = 'none';
      }
      updateCanvasWrapperStyle();
      saveHistory('Изменен фон холста');
      render();
    });

    dom.canvasBgPicker.addEventListener('input', (e) => {
      state.customBgColor = e.target.value;
      updateCanvasWrapperStyle();
      render();
    });

    dom.canvasBgPicker.addEventListener('change', () => {
      saveHistory('Изменен цвет фона');
    });

    // Зум
    dom.btnZoomIn.addEventListener('click', () => setZoom(state.zoom * 1.25));
    dom.btnZoomOut.addEventListener('click', () => setZoom(state.zoom / 1.25));
    dom.btnZoomFit.addEventListener('click', fitCanvasToViewport);
    dom.btnZoom100.addEventListener('click', () => setZoom(1.0));

    // Экспорт
    dom.btnExportPng.addEventListener('click', () => exportImage('png'));
    dom.btnExportJpg.addEventListener('click', () => exportImage('jpeg'));
  }

  // --- Загрузка демонстрационного примера ---
  function loadDemoSamples() {
    // 1. Градиентная сфера с мягкой прозрачностью
    const c1 = document.createElement('canvas');
    c1.width = 400;
    c1.height = 400;
    const ctx1 = c1.getContext('2d');
    const grad1 = ctx1.createRadialGradient(200, 200, 20, 200, 200, 180);
    grad1.addColorStop(0, 'rgba(59, 130, 246, 0.95)');
    grad1.addColorStop(0.4, 'rgba(139, 92, 246, 0.75)');
    grad1.addColorStop(0.8, 'rgba(236, 72, 153, 0.4)');
    grad1.addColorStop(1, 'rgba(236, 72, 153, 0)');
    ctx1.fillStyle = grad1;
    ctx1.beginPath();
    ctx1.arc(200, 200, 180, 0, Math.PI * 2);
    ctx1.fill();
    ctx1.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx1.lineWidth = 4;
    ctx1.beginPath();
    ctx1.arc(200, 200, 100, 0, Math.PI * 2);
    ctx1.stroke();

    // 2. Полупрозрачная стеклянная карточка
    const c2 = document.createElement('canvas');
    c2.width = 380;
    c2.height = 220;
    const ctx2 = c2.getContext('2d');
    ctx2.fillStyle = 'rgba(30, 41, 59, 0.78)';
    ctx2.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx2.lineWidth = 3;
    
    // Скругленный прямоугольник
    const rx = 10, ry = 10, rw = 360, rh = 200, rad = 20;
    ctx2.beginPath();
    ctx2.moveTo(rx + rad, ry);
    ctx2.lineTo(rx + rw - rad, ry);
    ctx2.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rad);
    ctx2.lineTo(rx + rw, ry + rh - rad);
    ctx2.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rad, ry + rh);
    ctx2.lineTo(rx + rad, ry + rh);
    ctx2.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rad);
    ctx2.lineTo(rx, ry + rad);
    ctx2.quadraticCurveTo(rx, ry, rx + rad, ry);
    ctx2.closePath();
    ctx2.fill();
    ctx2.stroke();

    ctx2.fillStyle = '#ffffff';
    ctx2.font = 'bold 22px Inter, sans-serif';
    ctx2.textAlign = 'center';
    ctx2.fillText('Blin Image Studio', 190, 105);
    ctx2.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx2.font = '13px Inter, sans-serif';
    ctx2.fillText('Слои • Прозрачность • Трансформация', 190, 140);

    // 3. Золотая звезда
    const c3 = document.createElement('canvas');
    c3.width = 240;
    c3.height = 240;
    const ctx3 = c3.getContext('2d');
    ctx3.fillStyle = '#fbbf24';
    ctx3.strokeStyle = '#f59e0b';
    ctx3.lineWidth = 5;
    ctx3.beginPath();
    const cx = 120, cy = 120, spikes = 5, outerR = 90, innerR = 45;
    let angle = Math.PI / 2 * 3;
    const step = Math.PI / spikes;
    ctx3.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx3.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      angle += step;
      ctx3.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      angle += step;
    }
    ctx3.closePath();
    ctx3.fill();
    ctx3.stroke();

    ctx3.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx3.beginPath();
    ctx3.arc(100, 100, 22, 0, Math.PI * 2);
    ctx3.fill();

    // 4. Слой с зеленым экраном (Green Screen Chroma Key)
    const c4 = document.createElement('canvas');
    c4.width = 280;
    c4.height = 280;
    const ctx4 = c4.getContext('2d');
    ctx4.fillStyle = '#00ff00';
    ctx4.fillRect(0, 0, 280, 280);
    // Ракета
    ctx4.fillStyle = '#ef4444';
    ctx4.beginPath();
    ctx4.ellipse(140, 140, 42, 80, 0, 0, Math.PI * 2);
    ctx4.fill();
    ctx4.fillStyle = '#38bdf8';
    ctx4.beginPath();
    ctx4.arc(140, 120, 22, 0, Math.PI * 2);
    ctx4.fill();
    ctx4.strokeStyle = '#ffffff';
    ctx4.lineWidth = 4;
    ctx4.stroke();
    ctx4.fillStyle = '#f59e0b';
    ctx4.beginPath();
    ctx4.moveTo(100, 160); ctx4.lineTo(65, 205); ctx4.lineTo(105, 195); ctx4.closePath();
    ctx4.fill();
    ctx4.beginPath();
    ctx4.moveTo(180, 160); ctx4.lineTo(215, 205); ctx4.lineTo(175, 195); ctx4.closePath();
    ctx4.fill();
    ctx4.fillStyle = '#facc15';
    ctx4.beginPath();
    ctx4.moveTo(120, 215); ctx4.lineTo(140, 260); ctx4.lineTo(160, 215); ctx4.closePath();
    ctx4.fill();
    ctx4.fillStyle = '#ffffff';
    ctx4.font = 'bold 15px Inter, sans-serif';
    ctx4.textAlign = 'center';
    ctx4.fillText('CHROMAKEY', 140, 60);

    const demos = [
      { name: 'Неоновое свечение (Alpha)', canvas: c1, x: 420, y: 360, opacity: 0.95, rot: 0, w: 340, h: 340, chroma: null },
      { name: 'Стеклянная плашка', canvas: c2, x: 640, y: 360, opacity: 0.85, rot: -6, w: 380, h: 220, chroma: null },
      { name: 'Золотая звезда', canvas: c3, x: 860, y: 220, opacity: 1.0, rot: 15, w: 180, h: 180, chroma: null },
      { name: 'Ракета (Зеленый экран)', canvas: c4, x: 740, y: 440, opacity: 1.0, rot: 8, w: 220, h: 220, chroma: { enabled: true, color: '#00ff00', tolerance: 40, feather: 15, spill: 50 } }
    ];

    let count = 0;
    demos.forEach((d, idx) => {
      const img = new Image();
      img.onload = () => {
        const layer = {
          id: 'layer_demo_' + idx + '_' + Date.now(),
          name: d.name,
          image: img,
          x: d.x,
          y: d.y,
          width: d.w,
          height: d.h,
          originalWidth: d.canvas.width,
          originalHeight: d.canvas.height,
          aspectRatio: d.canvas.width / d.canvas.height,
          rotation: d.rot,
          flipX: false,
          flipY: false,
          opacity: d.opacity,
          blendMode: 'source-over',
          visible: true,
          locked: false,
          chromaKey: d.chroma ? {
            enabled: d.chroma.enabled,
            color: d.chroma.color,
            targetR: 0,
            targetG: 255,
            targetB: 0,
            tolerance: d.chroma.tolerance,
            feather: d.chroma.feather,
            spill: d.chroma.spill
          } : {
            enabled: false,
            color: '#00ff00',
            targetR: 0,
            targetG: 255,
            targetB: 0,
            tolerance: 40,
            feather: 15,
            spill: 50
          },
          processedCanvas: null
        };

        if (layer.chromaKey && layer.chromaKey.enabled) {
          applyChromaKeyToLayer(layer);
        }

        state.layers.push(layer);
        count++;

        if (count === demos.length) {
          state.selectedId = layer.id;
          saveHistory('Загружен демо-пример');
          updateLayersUI();
          updatePropertiesUI();
          updateCanvasWrapperStyle();
          render();
        }
      };
      img.src = d.canvas.toDataURL('image/png');
    });
  }

  // --- Вычисление габаритов всех видимых слоев для точной обрезки при экспорте ---
  function getVisibleLayersBounds() {
    const visibleLayers = state.layers.filter(l => l.visible);
    if (visibleLayers.length === 0) {
      return { minX: 0, minY: 0, maxX: state.canvasWidth, maxY: state.canvasHeight };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    visibleLayers.forEach(layer => {
      const rad = layer.rotation * DEG2RAD;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const boundW = layer.width * cos + layer.height * sin;
      const boundH = layer.width * sin + layer.height * cos;

      minX = Math.min(minX, layer.x - boundW / 2);
      minY = Math.min(minY, layer.y - boundH / 2);
      maxX = Math.max(maxX, layer.x + boundW / 2);
      maxY = Math.max(maxY, layer.y + boundH / 2);
    });

    const clampedMinX = Math.max(0, Math.min(state.canvasWidth, Math.floor(minX)));
    const clampedMinY = Math.max(0, Math.min(state.canvasHeight, Math.floor(minY)));
    const clampedMaxX = Math.max(0, Math.min(state.canvasWidth, Math.ceil(maxX)));
    const clampedMaxY = Math.max(0, Math.min(state.canvasHeight, Math.ceil(maxY)));

    if (clampedMaxX <= clampedMinX || clampedMaxY <= clampedMinY) {
      return { minX: 0, minY: 0, maxX: state.canvasWidth, maxY: state.canvasHeight };
    }

    return {
      minX: clampedMinX,
      minY: clampedMinY,
      maxX: clampedMaxX,
      maxY: clampedMaxY
    };
  }

  // --- Экспорт изображения с автоматической обрезкой по краям готовой картинки ---
  function exportImage(format = 'png') {
    const visibleLayers = state.layers.filter(l => l.visible);
    if (visibleLayers.length === 0) {
      alert('Нет видимых слоев для экспорта!');
      return;
    }

    // 1. Отрисовываем все видимые слои на полноразмерный прозрачный canvas
    const layersCanvas = document.createElement('canvas');
    layersCanvas.width = state.canvasWidth;
    layersCanvas.height = state.canvasHeight;
    const layersCtx = layersCanvas.getContext('2d');

    visibleLayers.forEach(layer => {
      layersCtx.save();
      layersCtx.translate(layer.x, layer.y);
      layersCtx.rotate(layer.rotation * DEG2RAD);
      layersCtx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      layersCtx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      layersCtx.globalCompositeOperation = layer.blendMode || 'source-over';

      const sourceImg = (layer.chromaKey && layer.chromaKey.enabled && layer.processedCanvas)
        ? layer.processedCanvas
        : layer.image;
      layersCtx.drawImage(sourceImg, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      layersCtx.restore();
    });

    // 2. Вычисляем точные границы готовой композиции (учитывая все слои)
    let crop = getVisibleLayersBounds();

    // Пробуем уточнить границы по фактическим непрозрачным пикселям
    try {
      const wGeo = crop.maxX - crop.minX;
      const hGeo = crop.maxY - crop.minY;
      if (wGeo > 0 && hGeo > 0) {
        const imgData = layersCtx.getImageData(crop.minX, crop.minY, wGeo, hGeo);
        const data = imgData.data;
        let pMinX = wGeo, pMinY = hGeo, pMaxX = -1, pMaxY = -1;
        let hasPixel = false;

        for (let y = 0; y < hGeo; y++) {
          const rowOffset = y * wGeo * 4;
          for (let x = 0; x < wGeo; x++) {
            const alpha = data[rowOffset + x * 4 + 3];
            if (alpha > 0) {
              if (x < pMinX) pMinX = x;
              if (x > pMaxX) pMaxX = x;
              if (y < pMinY) pMinY = y;
              if (y > pMaxY) pMaxY = y;
              hasPixel = true;
            }
          }
        }

        if (hasPixel) {
          crop = {
            minX: crop.minX + pMinX,
            minY: crop.minY + pMinY,
            maxX: crop.minX + pMaxX + 1,
            maxY: crop.minY + pMaxY + 1
          };
        }
      }
    } catch (e) {
      console.warn('Использованы геометрические границы слоев для обрезки', e);
    }

    const cropW = Math.max(1, crop.maxX - crop.minX);
    const cropH = Math.max(1, crop.maxY - crop.minY);

    // 3. Создаем обрезанный финальный холст точного размера готовой картинки
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = cropW;
    finalCanvas.height = cropH;
    const finalCtx = finalCanvas.getContext('2d');

    // Если формат JPEG или задан непрозрачный цвет фона, заливаем фон
    if (format === 'jpeg') {
      const bg = state.canvasBg === 'transparent' ? '#ffffff' : 
                 (state.canvasBg === 'custom' ? state.customBgColor : state.canvasBg);
      finalCtx.fillStyle = bg;
      finalCtx.fillRect(0, 0, cropW, cropH);
    } else if (state.canvasBg !== 'transparent') {
      const bg = state.canvasBg === 'custom' ? state.customBgColor : state.canvasBg;
      finalCtx.fillStyle = bg;
      finalCtx.fillRect(0, 0, cropW, cropH);
    }

    // Переносим готовую композицию без лишних пустых полей
    finalCtx.drawImage(
      layersCanvas,
      crop.minX, crop.minY, cropW, cropH,
      0, 0, cropW, cropH
    );

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const quality = format === 'jpeg' ? 0.95 : undefined;

    finalCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `artwork_${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, mime, quality);
  }

  // --- Настройка интерактивных ручек ресайза холста (8 ручек: 4 угла + 4 стороны) ---
  function setupCanvasResizers() {
    const cursorMap = {
      'nw': 'nwse-resize',
      'ne': 'nesw-resize',
      'se': 'nwse-resize',
      'sw': 'nesw-resize',
      'n':  'ns-resize',
      's':  'ns-resize',
      'w':  'ew-resize',
      'e':  'ew-resize'
    };

    const startResize = (e, handle) => {
      e.preventDefault();
      e.stopPropagation();

      state.interaction.type = 'canvas-resize';
      state.interaction.canvasHandle = handle;
      state.interaction.startX = e.clientX;
      state.interaction.startY = e.clientY;
      state.interaction.startW = state.canvasWidth;
      state.interaction.startH = state.canvasHeight;
      state.interaction.startPanX = state.pan.x;
      state.interaction.startPanY = state.pan.y;
      state.interaction.layerStartPositions = state.layers.map(l => ({ id: l.id, x: l.x, y: l.y }));

      dom.viewport.style.cursor = cursorMap[handle] || 'crosshair';
    };

    document.querySelectorAll('.canvas-resize-handle').forEach(el => {
      const handle = el.dataset.handle;
      if (handle) {
        el.addEventListener('mousedown', (e) => startResize(e, handle));
      }
    });
  }

  // --- Интерактивное изменение ширины панели и высоты блоков свойств мышкой ---
  function setupPanelResizers() {
    const sidebar = document.getElementById('sidebarPanel');
    const sidebarResizer = document.getElementById('sidebarResizer');
    const resizerPropsToChroma = document.getElementById('resizerPropsToChroma');
    const resizerChromaToLayers = document.getElementById('resizerChromaToLayers');

    const secProps = document.getElementById('layerPropsSection');
    const secChroma = document.getElementById('chromaKeySection');
    const secLayers = document.getElementById('layersSection');

    // 1. Изменение ширины боковой панели (горизонтальное перетаскивание)
    if (sidebar && sidebarResizer) {
      let isDraggingSidebar = false;
      let startX = 0;
      let startWidth = 0;

      sidebarResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDraggingSidebar = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.classList.add('resizing-col');
        sidebarResizer.classList.add('active');
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDraggingSidebar) return;
        const deltaX = startX - e.clientX;
        const maxW = Math.max(300, window.innerWidth - 300);
        const newWidth = Math.max(260, Math.min(maxW, startWidth + deltaX));
        sidebar.style.width = `${newWidth}px`;
        applyTransform();
      });

      window.addEventListener('mouseup', () => {
        if (isDraggingSidebar) {
          isDraggingSidebar = false;
          document.body.classList.remove('resizing-col');
          sidebarResizer.classList.remove('active');
          applyTransform();
        }
      });
    }

    // 2. Вспомогательная функция для вертикального изменения высоты между секциями
    function makeVerticalResizer(handle, upperSec, lowerSec) {
      if (!handle || !upperSec || !lowerSec) return;

      let isDragging = false;
      let startY = 0;
      let startUpperH = 0;
      let startLowerH = 0;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        startY = e.clientY;
        startUpperH = upperSec.getBoundingClientRect().height;
        startLowerH = lowerSec.getBoundingClientRect().height;
        document.body.classList.add('resizing-row');
        handle.classList.add('active');
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        const minH = 48; // минимальная высота

        const newUpperH = Math.max(minH, startUpperH + deltaY);
        const newLowerH = Math.max(minH, startLowerH - deltaY);

        upperSec.style.flex = `0 0 ${newUpperH}px`;
        upperSec.style.height = `${newUpperH}px`;
        lowerSec.style.flex = `0 0 ${newLowerH}px`;
        lowerSec.style.height = `${newLowerH}px`;
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          document.body.classList.remove('resizing-row');
          handle.classList.remove('active');
        }
      });
    }

    // Ресайзер между Свойствами слоя и Хромакеем
    if (resizerPropsToChroma && secProps && secChroma) {
      makeVerticalResizer(resizerPropsToChroma, secProps, secChroma);
    }

    // Ресайзер между Хромакеем и Слоями
    if (resizerChromaToLayers && secChroma && secLayers) {
      makeVerticalResizer(resizerChromaToLayers, secChroma, secLayers);
    }
  }

  // --- Запуск приложения ---
  function start() {
    initCanvas();
    bindToolbarEvents();
    bindPropertyEvents();
    setupCanvasResizers();
    setupPanelResizers();
    saveHistory('Начальное состояние');

    // Адаптация при ресайзе окна
    window.addEventListener('resize', () => {
      applyTransform();
    });
  }

  start();
})();
