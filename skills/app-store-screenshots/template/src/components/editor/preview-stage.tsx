"use client";
import * as React from "react";
import { DEVICE_LABEL, LAYOUT_LABEL } from "@/lib/constants";
import type {
  Device,
  ElementId,
  ElementTransform,
  Orientation,
  SelectedElement,
  Slide,
  Theme,
} from "@/lib/types";
import { DeckCanvas, getCanvas } from "./slide-canvas";

type Props = {
  slides: Slide[];
  activeSlideId: string | null;
  device: Device;
  orientation: Orientation;
  theme: Theme;
  locale: string;
  appName?: string;
  appIcon?: string;
  selectedElement: SelectedElement | null;
  onActiveSlideChange: (id: string) => void;
  onLabelChange: (slide: Slide, v: string) => void;
  onHeadlineChange: (slide: Slide, v: string) => void;
  onElementChange: (slideId: string, id: ElementId, t: ElementTransform) => void;
  onSelectElement: (element: SelectedElement | null) => void;
};

// Fits one full-resolution screen inside the viewport while keeping the whole
// deck horizontally scrollable as one connected canvas.
export function PreviewStage({
  slides,
  activeSlideId,
  device,
  orientation,
  theme,
  locale,
  appName,
  appIcon,
  selectedElement,
  onActiveSlideChange,
  onLabelChange,
  onHeadlineChange,
  onElementChange,
  onSelectElement,
}: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.2);
  const { cW, cH } = getCanvas(device, orientation);
  const totalW = Math.max(1, slides.length) * cW;
  const activeIndex = Math.max(0, slides.findIndex((slide) => slide.id === activeSlideId));
  const activeSlide = slides[activeIndex] || slides[0] || null;

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const sx = (rect.width - 96) / cW;
      const sy = (rect.height - 96) / cH;
      setScale(Math.max(0.05, Math.min(sx, sy)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cW, cH]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !activeSlide) return;
    const screenLeft = activeIndex * cW * scale;
    const screenWidth = cW * scale;
    const targetLeft = Math.max(0, screenLeft - (scroller.clientWidth - screenWidth) / 2);
    scroller.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [activeIndex, activeSlide, cW, scale]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[radial-gradient(70%_70%_at_50%_35%,_hsl(var(--background))_0%,_hsl(var(--muted))_100%)]"
    >
      <div ref={scrollerRef} className="h-full w-full overflow-auto p-12">
        <div
          style={{
            width: totalW * scale,
            height: cH * scale,
            position: "relative",
            flexShrink: 0,
            filter: "drop-shadow(0 32px 42px rgba(15, 23, 42, 0.18))",
          }}
        >
          <div
            style={{
              width: totalW,
              height: cH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <DeckCanvas
              slides={slides}
              device={device}
              orientation={orientation}
              theme={theme}
              locale={locale}
              appName={appName}
              appIcon={appIcon}
              editable
              previewScale={scale}
              selectedElement={selectedElement}
              activeSlideId={activeSlide?.id || null}
              showGuides
              edit={{
                onLabelChange: (slideId, value) => {
                  const slide = slides.find((s) => s.id === slideId);
                  if (slide) onLabelChange(slide, value);
                },
                onHeadlineChange: (slideId, value) => {
                  const slide = slides.find((s) => s.id === slideId);
                  if (slide) onHeadlineChange(slide, value);
                },
                onElementChange,
                onSelectElement,
                onSelectScreen: onActiveSlideChange,
              }}
            />
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        <span className="font-medium text-foreground">{DEVICE_LABEL[device]}</span>
        {activeSlide && (
          <>
            <span aria-hidden>·</span>
            <span>Screen {activeIndex + 1}</span>
            <span aria-hidden>·</span>
            <span>{LAYOUT_LABEL[activeSlide.layout]}</span>
          </>
        )}
        {orientation === "landscape" && (
          <>
            <span aria-hidden>·</span>
            <span>landscape</span>
          </>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-[10px] tabular-nums text-muted-foreground shadow-sm backdrop-blur">
        <span>{slides.length}× {cW}×{cH}</span>
        <span aria-hidden>·</span>
        <span>{(scale * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
