import { useLayoutEffect, useRef, useState } from "react";

function BannerLines({ lines }) {
  const root = useRef(null);
  const [shape, setShape] = useState(null);
  useLayoutEffect(() => {
    const element = root.current;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const scale = bounds.width / element.offsetWidth || 1;
      const boxes = [...element.querySelectorAll(".headline-line")].map(
        (line) => {
          const rect = line.getBoundingClientRect();
          return {
            x: (rect.left - bounds.left) / scale,
            y: (rect.top - bounds.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          };
        },
      );
      const next = {
        width: bounds.width / scale,
        height: bounds.height / scale,
        radius: Math.max(
          3,
          Math.min(10, parseFloat(getComputedStyle(element).fontSize) * 0.07),
        ),
        boxes,
      };
      setShape((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    let mounted = true;
    document.fonts?.ready.then(() => {
      if (mounted) measure();
    });
    return () => {
      mounted = false;
      observer.disconnect();
    };
  }, [lines.map((line) => line.text).join("\n")]);
  return (
    <span className="headline-banner-group" ref={root}>
      {shape && (
        <svg
          className="headline-banner-shape"
          aria-hidden="true"
          viewBox={`0 0 ${shape.width} ${shape.height}`}
          width={shape.width}
          height={shape.height}
        >
          {shape.boxes.map((box, i) => (
            <g key={i}>
              <rect {...box} rx={shape.radius} />
              {i > 0 && (
                <rect
                  x={Math.max(box.x, shape.boxes[i - 1].x)}
                  y={box.y - shape.radius}
                  width={Math.min(box.width, shape.boxes[i - 1].width)}
                  height={shape.radius * 2}
                />
              )}
            </g>
          ))}
        </svg>
      )}
      {lines.map((line, i) => (
        <span className="headline-line banner" key={i}>
          {line.text}
        </span>
      ))}
    </span>
  );
}

export default function Headline({ lines, text }) {
  const groups = [];
  for (const line of lines || [{ text, style: "" }]) {
    const previous = groups.at(-1);
    if (line.style === "banner" && previous?.banner) previous.lines.push(line);
    else groups.push({ banner: line.style === "banner", lines: [line] });
  }
  return (
    <h1 className="headline">
      {groups.map((group, i) =>
        group.banner ? (
          <BannerLines lines={group.lines} key={i} />
        ) : (
          <span key={i} className="headline-line-group">
            {group.lines.map((line, j) => (
              <span key={j} className={`headline-line ${line.style || ""}`}>
                {line.text}
              </span>
            ))}
          </span>
        ),
      )}
    </h1>
  );
}
