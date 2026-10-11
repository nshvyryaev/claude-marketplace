// Факты дерева узлов Cocos и перевод мировых координат в координаты страницы.
//
// Внедряется в страницу после shim и до моста. К движку обращается лениво, в
// момент вызова: при внедрении его ещё нет.
//
// Канвас Cocos — видимая область; в режиме «весь кадр» (Show All: fitWidth +
// fitHeight) она меньше элемента и стоит по центру с полями, масштаб по осям
// одинаковый. Без полей (fitHeight / fitWidth) формула даёт прежний результат.
export function mapRect(rect, canvasWorld, element) {
  const s = Math.min(element.width / canvasWorld.w, element.height / canvasWorld.h);
  const left = element.left + (element.width - canvasWorld.w * s) / 2;
  const top = element.top + (element.height - canvasWorld.h * s) / 2;
  return {
    x: left + (rect.x - canvasWorld.x) * s,
    y: top + (canvasWorld.y + canvasWorld.h - (rect.y + rect.h)) * s,
    width: rect.w * s,
    height: rect.h * s,
  };
}

function viewMain(mapRectFn) {
  const cls = (name) => window.cc.js.getClassByName(name);
  const scene = () => window.cc.director.getScene();

  function worldRect(node) {
    const ut = node.getComponent(cls('cc.UITransform'));
    if (!ut) return null;
    const b = ut.getBoundingBoxToWorld();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  // Прямоугольник самого узла, без детей: getBoundingBoxToWorld объединяет
  // рамки детей, и узел за краем кадра (игрок на нижней кромке) растягивал бы
  // канвас — перевод в CSS px поехал бы.
  function ownRect(node) {
    const ut = node.getComponent(cls('cc.UITransform'));
    if (!ut) return null;
    const p = node.worldPosition;
    const sc = node.worldScale;
    const w = ut.contentSize.width * sc.x;
    const h = ut.contentSize.height * sc.y;
    return { x: p.x - ut.anchorPoint.x * w, y: p.y - ut.anchorPoint.y * h, w, h };
  }

  function opacity(node) {
    let value = 255;
    for (let n = node; n; n = n.parent) {
      const o = n.getComponent(cls('cc.UIOpacity'));
      if (o) value = (value * o.opacity) / 255;
    }
    return Math.round(value);
  }

  function color(node) {
    const r = node.getComponent(cls('cc.Sprite')) || node.getComponent(cls('cc.Label'));
    return r ? [r.color.r, r.color.g, r.color.b, r.color.a] : null;
  }

  function pathOf(node) {
    const parts = [];
    for (let n = node; n && n.parent; n = n.parent) parts.unshift(n.name);
    return parts.join('/');
  }

  function describe(node) {
    return { active: node.activeInHierarchy, worldRect: worldRect(node), opacity: opacity(node), color: color(node), children: node.children.length };
  }

  window.__botView = {
    node(path) {
      let n = scene();
      for (const name of path.split('/')) {
        n = n && n.getChildByName(name);
        if (!n) return null;
      }
      return describe(n);
    },
    find(className) {
      const C = cls(className);
      const s = scene();
      if (!C || !s) return [];
      return s.getComponentsInChildren(C).map((c) => ({ path: pathOf(c.node), active: c.node.activeInHierarchy, worldRect: worldRect(c.node), opacity: opacity(c.node) }));
    },
    pageRect(rect) {
      const canvasNode = scene().getChildByName('Canvas');
      const canvasWorld = ownRect(canvasNode);
      const element = document.getElementById('GameCanvas').getBoundingClientRect();
      return mapRectFn(rect, canvasWorld, element);
    },
  };
}

export function viewSource() {
  return `(${viewMain.toString()})(${mapRect.toString()});`;
}
