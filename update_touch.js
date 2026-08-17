const fs = require('fs');
const content = fs.readFileSync('frontend/src/hooks/useChartGesture.tsx', 'utf8');

const updated = content.replace(
`    function onTouchMove(e: TouchEvent) {
      if (axisIntent.current === "horizontal" && e.cancelable) e.preventDefault();
    }`,
`    function onTouchMove(e: TouchEvent) {
      if (axisIntent.current === "pending" && e.touches.length === 1 && panGesture.current) {
        const dx = Math.abs(e.touches[0].clientX - panGesture.current.startClientX);
        const dy = Math.abs(e.touches[0].clientY - panGesture.current.startClientY);
        if (Math.max(dx, dy) >= AXIS_LOCK_THRESHOLD_PX) {
          axisIntent.current = dx > dy ? "horizontal" : "vertical";
        }
      }
      if (axisIntent.current === "horizontal" && e.cancelable) {
        e.preventDefault();
      }
    }`
);

fs.writeFileSync('frontend/src/hooks/useChartGesture.tsx', updated);
