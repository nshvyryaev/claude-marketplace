// Факты дерева узлов Cocos и перевод мировых координат в координаты страницы.
//
// Внедряется в страницу после shim и до моста. К движку обращается лениво, в
// момент вызова: при внедрении его ещё нет.
export function mapRect(rect, canvasWorld, element) {
  const sx = element.width / canvasWorld.w;
  const sy = element.height / canvasWorld.h;
  return {
    x: element.left + (rect.x - canvasWorld.x) * sx,
    y: element.top + (canvasWorld.y + canvasWorld.h - (rect.y + rect.h)) * sy,
    width: rect.w * sx,
    height: rect.h * sy,
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
      const canvasWorld = worldRect(canvasNode);
      const element = document.getElementById('GameCanvas').getBoundingClientRect();
      return mapRectFn(rect, canvasWorld, element);
    },
  };
}

export function viewSource() {
  return `(${viewMain.toString()})(${mapRect.toString()});`;
}
