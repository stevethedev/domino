import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import type { GraphEdge } from "../../graph/types";

export type LinkEdgeData = {
  edge: GraphEdge;
  inCycle: boolean;
  sourceDone: boolean;
  dimmed: boolean;
  critical: boolean;
  /** Edge removed for layout (closes a cycle); it points right-to-left, so route it underneath. */
  back: boolean;
};
export type LinkFlowEdge = Edge<LinkEdgeData, "link">;

export const LinkEdge = memo(function LinkEdge(props: EdgeProps<LinkFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  if (!data) return null;
  const [path, labelX, labelY] =
    data.back && targetX < sourceX
      ? loopPath(sourceX, sourceY, targetX, targetY)
      : // Orthogonal segments with rounded corners line up with the layered card grid.
        getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 18 });
  const { edge, inCycle, sourceDone, dimmed, critical } = data;

  let opacity = edge.kind === "duplicates" ? 0.4 : 1;
  if (sourceDone) opacity = Math.min(opacity, 0.25);
  if (dimmed) opacity *= 0.2;

  const stroke = inCycle ? "var(--cycle)" : critical ? "var(--critical)" : "var(--edge)";
  const style = {
    stroke,
    strokeWidth: critical || inCycle ? 2.5 : 1.6,
    strokeDasharray: edge.kind === "relates" ? "6 4" : edge.kind === "duplicates" ? "1.5 4" : undefined,
    strokeLinecap: edge.kind === "duplicates" ? ("round" as const) : undefined,
    opacity,
  };

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={markerEnd} style={style} />
      {edge.aggregate && (
        <EdgeLabelRenderer>
          <div
            className={`agg-label${edge.aggregate.open ? "" : " closed"}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + (edge.crossSite ? 16 : 0)}px)`,
              opacity: Math.max(opacity, 0.5),
            }}
          >
            {edge.aggregate.links} {edge.aggregate.links === 1 ? "link" : "links"} · {edge.aggregate.open} open
          </div>
        </EdgeLabelRenderer>
      )}
      {inCycle && (
        <EdgeLabelRenderer>
          <div
            className="cycle-marker"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (edge.crossSite ? 16 : 0)}px)`, opacity }}
            title="Part of a blocking cycle"
            aria-label="Part of a blocking cycle"
          >
            ⟲
          </div>
        </EdgeLabelRenderer>
      )}
      {edge.crossSite && (
        <EdgeLabelRenderer>
          <div
            className="xsite-marker"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, opacity }}
            title="Cross-site link"
            aria-label="Cross-site link"
          >
            ⇄
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

/** A loop that leaves right, drops below both cards, and re-enters the target from the left. */
function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const below = Math.max(sy, ty) + 90;
  const path = `M ${sx} ${sy} C ${sx + 80} ${sy}, ${sx + 80} ${below}, ${sx} ${below} L ${tx} ${below} C ${tx - 80} ${below}, ${tx - 80} ${ty}, ${tx} ${ty}`;
  return [path, (sx + tx) / 2, below];
}
