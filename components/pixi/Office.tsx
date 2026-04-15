"use client";

import { useEffect, useRef } from "react";
import type { OfficeConfig, DeskConfig, IndicatorKind } from "@/lib/office-types";
import {
  preloadPremades,
  loadPremade,
  loadTilesheet,
  idleFramesForFacing,
} from "@/lib/sprite-loader";

type Props = {
  office: OfficeConfig;
  busyDeskIds?: ReadonlySet<string>;
  agentStatus?: ReadonlyMap<string, IndicatorKind>;
  selectedDeskId?: string | null;
  onDeskSelect?: (deskId: string | null) => void;
  onAgentClick?: (deskId: string, clientX: number, clientY: number) => void;
  onDeskDrop?: (deskId: string, e: React.DragEvent<HTMLDivElement>) => void;
  onAgentMove?: (deskId: string, gridX: number, gridY: number) => void;
  showGrid?: boolean;
};

export default function Office({
  office,
  busyDeskIds,
  agentStatus,
  selectedDeskId,
  onDeskSelect,
  onAgentClick,
  onDeskDrop,
  onAgentMove,
  showGrid = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<string | null>(selectedDeskId ?? null);
  selectedRef.current = selectedDeskId ?? null;
  const onSelectRef = useRef(onDeskSelect);
  onSelectRef.current = onDeskSelect;
  const onAgentClickRef = useRef(onAgentClick);
  onAgentClickRef.current = onAgentClick;
  const onAgentMoveRef = useRef(onAgentMove);
  onAgentMoveRef.current = onAgentMove;
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;

  const busyRef = useRef<ReadonlySet<string>>(busyDeskIds ?? new Set());
  busyRef.current = busyDeskIds ?? new Set();
  const lastBusySigRef = useRef<string>("");

  const statusRef = useRef<ReadonlyMap<string, IndicatorKind>>(
    agentStatus ?? new Map(),
  );
  statusRef.current = agentStatus ?? new Map();
  const lastStatusSigRef = useRef<string>("");

  // Geometry snapshot for drop hit-testing in page coordinates
  const geomRef = useRef<{
    canvas: HTMLCanvasElement | null;
    worldX: number;
    worldY: number;
    tw: number;
    th: number;
    desks: DeskConfig[];
  }>({
    canvas: null,
    worldX: 0,
    worldY: 0,
    tw: office.tile.w,
    th: office.tile.h,
    desks: office.desks,
  });

  useEffect(() => {
    let destroyed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const PIXI = await import("pixi.js");
      if (destroyed || !hostRef.current) return;

      const {
        Application,
        Container,
        Graphics,
        Sprite,
        AnimatedSprite,
        ColorMatrixFilter,
        Text,
        TextStyle,
      } = PIXI;

      const app = new Application();
      await app.init({
        background: office.theme.bg,
        resizeTo: hostRef.current,
        antialias: false,
        roundPixels: true,
      });
      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }

      // ── Preload assets ────────────────────────────────────────────────────
      const premadePaths = office.agents
        .map((a) => `/sprites/characters/${a.visual.premade}`)
        .filter(Boolean);
      await preloadPremades(premadePaths);

      const premadeRoomConfig = office.theme.premadeRoom;
      const interiorConfig = office.theme.interior;
      let tilesheet: Awaited<ReturnType<typeof loadTilesheet>> | null = null;
      // premadeRoom takes precedence; only load tilesheet if no premadeRoom is set
      if (!premadeRoomConfig && interiorConfig) {
        tilesheet = await loadTilesheet(
          `/sprites/interiors/${interiorConfig.tilesheet}`,
          interiorConfig.tileSize,
        );
      }

      // Load premade room layer textures if configured.
      // Assets.load returns unknown in PixiJS v8 — cast to Texture explicitly.
      let roomLayerTextures: InstanceType<typeof PIXI.Texture>[] = [];
      if (premadeRoomConfig) {
        const { Assets } = PIXI;
        roomLayerTextures = await Promise.all(
          premadeRoomConfig.layers.map((layerPath) =>
            Assets.load(`/sprites/interiors/premade_rooms/${layerPath}`) as Promise<InstanceType<typeof PIXI.Texture>>
          )
        );
      }

      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }

      hostRef.current.appendChild(app.canvas);

      // ── Top-down projection ───────────────────────────────────────────────
      // tw === th === tile square side in screen pixels (source 16px × 4 display scale).
      // Both configs set tile.w = tile.h = 64 for square top-down cells.
      const tw = office.tile.w;
      const th = office.tile.h;

      // flat(gx, gy) → screen position of the top-left corner of cell (gx, gy)
      const flat = (gx: number, gy: number) => ({
        x: gx * tw,
        y: gy * th,
      });

      const world = new Container();
      app.stage.addChild(world);

      // roomBg: premade room layers that render below characters
      // floor: per-tile fallback floor (only used when premadeRoom is not set)
      // furniture: desks + agents
      // roomFg: premade room layers that render above characters (e.g. hanging lights, front rails)
      const roomBg = new Container();
      const floor = new Container();
      const furniture = new Container();
      const roomFg = new Container();
      const gridOverlay = new Container();
      gridOverlay.visible = showGridRef.current;
      world.addChild(roomBg, floor, furniture, roomFg, gridOverlay);

      // ── Palette filter ────────────────────────────────────────────────────
      const pf = office.theme.paletteFilter;
      if (pf) {
        const cmf = new ColorMatrixFilter();
        if (pf.hue !== undefined) cmf.hue(pf.hue, false);
        if (pf.saturation !== undefined) {
          // Config: 0..2 where 1 = no change → Pixi saturate: -1..1 where 0 = no change
          cmf.saturate(pf.saturation - 1, true);
        }
        if (pf.brightness !== undefined) {
          // Config: 0..2 where 1 = no change → Pixi brightness: same scale
          cmf.brightness(pf.brightness, true);
        }
        if (pf.contrast !== undefined) {
          // Config: 0..2 where 1 = normal → Pixi contrast: 0..1 where 0.5 = normal
          cmf.contrast(pf.contrast * 0.5, true);
        }
        if (pf.tint !== undefined && pf.tintStrength !== undefined) {
          const tintFilter = new ColorMatrixFilter();
          tintFilter.tint(pf.tint, false);
          tintFilter.alpha = pf.tintStrength;
          world.filters = [cmf, tintFilter];
        } else {
          world.filters = [cmf];
        }
      }

      // ── World sizing and centering ────────────────────────────────────────
      const worldW = office.grid.cols * tw;
      const worldH = office.grid.rows * th;
      const center = () => {
        const wx = Math.round((app.renderer.width - worldW) / 2);
        const wy = Math.round((app.renderer.height - worldH) / 2);
        world.x = wx;
        world.y = wy;
        geomRef.current = {
          canvas: app.canvas,
          worldX: wx,
          worldY: wy,
          tw,
          th,
          desks: office.desks,
        };
      };
      center();
      app.renderer.on("resize", center);

      const inRoom = (gx: number, gy: number) =>
        office.rooms.some(
          (r) => gx >= r.gridX && gx < r.gridX + r.w && gy >= r.gridY && gy < r.gridY + r.h,
        );

      // ── Floor / Room Background ───────────────────────────────────────────
      if (premadeRoomConfig && roomLayerTextures.length > 0) {
        // Premade room mode: render each layer PNG as a scaled Sprite anchored at (0,0).
        // Scale factor: tw / sourceTileSize  (e.g. 64/16 = 4× for 64px display tiles)
        const scale = tw / premadeRoomConfig.sourceTileSize;
        const depthIdx = premadeRoomConfig.characterDepthIndex ?? roomLayerTextures.length;

        roomLayerTextures.forEach((tex, i) => {
          // Ensure crisp nearest-neighbor scaling
          tex.source.scaleMode = "nearest";
          const s = new Sprite(tex);
          s.anchor.set(0, 0);
          s.position.set(0, 0);
          s.scale.set(scale);
          if (i < depthIdx) {
            roomBg.addChild(s);
          } else {
            roomFg.addChild(s);
          }
        });
      } else {
        // Per-tile floor (fallback path when premadeRoom is not configured)
        for (let gy = 0; gy < office.grid.rows; gy++) {
          for (let gx = 0; gx < office.grid.cols; gx++) {
            const { x, y } = flat(gx, gy);
            const isIn = inRoom(gx, gy);

            if (tilesheet && interiorConfig) {
              // Use tilesheet sprite — scale 16px source tile to tw×th display size.
              // Nearest-neighbor scaling is set on the texture source so pixels stay crisp.
              const [col, row] = isIn
                ? interiorConfig.floorTileIndex
                : (interiorConfig.wallTileIndex ?? interiorConfig.floorTileIndex);
              const tex = tilesheet.getTile(col, row);
              // Ensure crisp pixel scaling (nearest-neighbor)
              tex.source.scaleMode = "nearest";
              const tile = new Sprite(tex);
              tile.width = tw;
              tile.height = th;
              tile.anchor.set(0, 0);
              tile.position.set(x, y);
              floor.addChild(tile);
            } else {
              // Fallback: flat colored square
              const color = isIn
                ? (gx + gy) % 2 === 0
                  ? office.theme.floor
                  : office.theme.floorAlt
                : office.theme.wall;
              const tile = new Graphics()
                .rect(0, 0, tw, th)
                .fill(color)
                .stroke({ color: 0x000000, width: 1, alpha: 0.25 });
              tile.position.set(x, y);
              floor.addChild(tile);
            }
          }
        }
      }

      // ── Desks ─────────────────────────────────────────────────────────────
      // Y-sorted so agents standing "south" of a desk render in front.
      furniture.sortableChildren = true;
      const deskShapes = new Map<string, InstanceType<typeof Graphics>>();

      const paintDesk = (g: InstanceType<typeof Graphics>, highlighted: boolean) => {
        g.clear();
        // Flat top-down desk: filled square with a subtle border
        g.rect(0, 0, tw, th)
          .fill(highlighted ? office.theme.highlight : office.theme.deskTop)
          .stroke({ color: 0x000000, width: 2, alpha: 0.6 });
        // Desk surface detail: inner inset rectangle
        g.rect(tw * 0.1, th * 0.1, tw * 0.8, th * 0.6)
          .fill(office.theme.deskSide)
          .stroke({ color: 0x000000, width: 1, alpha: 0.4 });
      };

      for (const desk of office.desks) {
        const { x, y } = flat(desk.gridX, desk.gridY);
        const zBase = desk.gridY * office.grid.cols + desk.gridX;

        if (tilesheet && interiorConfig) {
          // Tilesheet desk: pick a desk-looking tile from the furniture sheet.
          // NOTE: these indices are guesses — Connor should swap by eye after launch.
          // fishing_16x16.png  → [0,1] looks like a tackle-box/desk object (row 1, first item)
          // conference_hall_16x16.png → [0,1] looks like a sofa/bench top
          const [col, row] = interiorConfig.floorTileIndex; // reuse as desk tile; config has no separate deskTileIndex
          const tex = tilesheet.getTile(col, row);
          tex.source.scaleMode = "nearest";
          const s = new Sprite(tex);
          s.width = tw;
          s.height = th;
          s.anchor.set(0, 0);
          s.tint = parseInt(office.theme.deskTop.replace("#", ""), 16);
          s.position.set(x, y);
          s.zIndex = zBase + 1;
          furniture.addChild(s);
        }

        // Interactive Graphics rect for hit-testing and selection highlight.
        // In premadeRoom mode the room art shows real desks, so keep this rect
        // invisible (alpha=0) for hit-testing only; it becomes a thin highlight on select.
        const g = new Graphics();
        paintDesk(g, false);
        g.position.set(x, y);
        g.eventMode = "static";
        g.cursor = "pointer";
        g.zIndex = zBase + 1;
        g.on("pointertap", () => onSelectRef.current?.(desk.id));
        // Hide fallback rect when using premadeRoom or tilesheet — room/sprite handles visuals
        if (premadeRoomConfig || tilesheet) {
          g.alpha = 0;
        }
        deskShapes.set(desk.id, g);
        furniture.addChild(g);
      }

      // ── Agents ────────────────────────────────────────────────────────────
      // Map from agentId → { body, pip, exclamation (yellow "!"), check (green "✓"), nameTag, indicatorBaseY }
      type AgentSprites = {
        body: InstanceType<typeof AnimatedSprite>;
        pip: InstanceType<typeof Graphics>;
        exclamation: InstanceType<typeof Graphics>;
        check: InstanceType<typeof Graphics>;
        nameTag: InstanceType<typeof Container>;
        indicatorBaseY: number;
      };
      const agentSprites = new Map<string, AgentSprites>();

      const nameTagStyle = new TextStyle({
        fontFamily: "monospace",
        fontSize: 9,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3, join: "round" },
      });

      const buildNameTag = (name: string) => {
        const c = new Container();
        const label = new Text({ text: name, style: nameTagStyle });
        label.anchor.set(0.5, 0.5);
        const padX = 5;
        const padY = 2;
        const w = Math.ceil(label.width) + padX * 2;
        const h = Math.ceil(label.height) + padY * 2;
        const bg = new Graphics()
          .roundRect(-w / 2, -h / 2, w, h, 4)
          .fill({ color: 0x000000, alpha: 0.7 })
          .stroke({ color: 0xffffff, alpha: 0.25, width: 1 });
        c.addChild(bg, label);
        return c;
      };

      const drawExclamation = (g: InstanceType<typeof Graphics>) => {
        g.clear();
        g.roundRect(-11, -14, 22, 26, 5)
          .fill(0xfacc15)
          .stroke({ color: 0x000000, width: 1.5 });
        g.rect(-1.75, -9, 3.5, 12).fill(0xffffff);
        g.circle(0, 7, 2).fill(0xffffff);
      };

      const drawCheck = (g: InstanceType<typeof Graphics>) => {
        g.clear();
        g.circle(0, 0, 12)
          .fill(0x10b981)
          .stroke({ color: 0x000000, width: 1.5 });
        g.moveTo(-5, 0)
          .lineTo(-1, 5)
          .lineTo(6, -5)
          .stroke({ color: 0xffffff, width: 2.5, cap: "round", join: "round" });
      };

      const emitAgentClick = (
        deskId: string,
        body: InstanceType<typeof AnimatedSprite>,
      ) => {
        const globalPos = body.getGlobalPosition();
        const rect = app.canvas.getBoundingClientRect();
        const sx = rect.width / app.canvas.width;
        const sy = rect.height / app.canvas.height;
        const clientX = rect.left + globalPos.x * sx;
        const clientY = rect.top + (globalPos.y - body.height - 8) * sy;
        onAgentClickRef.current?.(deskId, clientX, clientY);
      };

      for (const agent of office.agents) {
        const desk = office.desks.find((d) => d.id === agent.deskId);
        if (!desk) continue;

        // Place agent centered on the desk cell, offset upward so they appear
        // to stand behind/at the desk in Y-sorted top-down view.
        const { x, y } = flat(desk.gridX, desk.gridY);
        const agentCenterX = x + tw / 2;
        // Offset agent upward by half a cell so they're visually above the desk center
        const agentBottomY = y + th * 0.75;

        const premadePath = `/sprites/characters/${agent.visual.premade}`;
        const premadeData = await loadPremade(premadePath);
        const frames = idleFramesForFacing(premadeData.frames, desk.facing);

        const body = new AnimatedSprite({
          textures: frames,
          animationSpeed: 0.08,
          loop: true,
          autoPlay: true,
        });
        // Anchor at bottom-center of the 16×32 sprite
        body.anchor.set(0.5, 1.0);
        // Scale: character source is 16×32px; scale so character height ≈ 1.5 cells
        const scale = tw / 16;
        body.scale.set(scale);
        body.position.set(agentCenterX, agentBottomY);
        // zIndex: gy-based so agents south of desks render in front
        const zBase = desk.gridY * office.grid.cols + desk.gridX;
        body.zIndex = zBase + 3;
        body.eventMode = "static";
        body.cursor = "pointer";
        const deskId = desk.id;
        body.on("pointertap", (ev) => {
          emitAgentClick(deskId, body);
          ev.stopPropagation();
        });
        furniture.addChild(body);

        // Busy pip — small colored circle above agent's head; hidden by default
        const indicatorBaseY = agentBottomY - body.height - 14;
        const pip = new Graphics();
        pip.circle(0, 0, 4).fill(office.theme.highlight).stroke({ color: 0x000000, width: 1 });
        pip.position.set(agentCenterX, indicatorBaseY + 4);
        pip.zIndex = zBase + 4;
        pip.visible = false;
        furniture.addChild(pip);

        // Status indicators (mutually exclusive; one visible at a time)
        const exclamation = new Graphics();
        drawExclamation(exclamation);
        exclamation.position.set(agentCenterX, indicatorBaseY);
        exclamation.zIndex = zBase + 6;
        exclamation.visible = false;
        exclamation.eventMode = "static";
        exclamation.cursor = "pointer";
        exclamation.on("pointertap", (ev) => {
          emitAgentClick(deskId, body);
          ev.stopPropagation();
        });
        furniture.addChild(exclamation);

        const check = new Graphics();
        drawCheck(check);
        check.position.set(agentCenterX, indicatorBaseY);
        check.zIndex = zBase + 6;
        check.visible = false;
        check.eventMode = "static";
        check.cursor = "pointer";
        check.on("pointertap", (ev) => {
          emitAgentClick(deskId, body);
          ev.stopPropagation();
        });
        furniture.addChild(check);

        // Floating name tag — small pill above the head, always visible
        const nameTag = buildNameTag(agent.name);
        const nameTagY = indicatorBaseY - 14;
        nameTag.position.set(agentCenterX, nameTagY);
        nameTag.zIndex = zBase + 7;
        furniture.addChild(nameTag);

        agentSprites.set(agent.id, {
          body,
          pip,
          exclamation,
          check,
          nameTag,
          indicatorBaseY,
        });
      }

      // ── Grid overlay ─────────────────────────────────────────────────────
      // Built once; toggled via gridOverlay.visible in the tick loop.
      {
        const lineStyle = { color: 0xffffff, alpha: 0.3, width: 1 };
        const labelStyle = new TextStyle({
          fontFamily: "monospace",
          fontSize: 8,
          fill: { color: 0xffffff, alpha: 0.5 },
        });
        const g = new Graphics();
        // Vertical lines
        for (let gx = 0; gx <= office.grid.cols; gx++) {
          g.moveTo(gx * tw, 0).lineTo(gx * tw, office.grid.rows * th);
        }
        // Horizontal lines
        for (let gy = 0; gy <= office.grid.rows; gy++) {
          g.moveTo(0, gy * th).lineTo(office.grid.cols * tw, gy * th);
        }
        g.stroke(lineStyle);
        gridOverlay.addChild(g);

        // Coordinate labels — one per cell
        for (let gy = 0; gy < office.grid.rows; gy++) {
          for (let gx = 0; gx < office.grid.cols; gx++) {
            const label = new Text({ text: `${gx},${gy}`, style: labelStyle });
            label.position.set(gx * tw + 2, gy * th + 2);
            gridOverlay.addChild(label);
          }
        }
      }

      // ── Tick loop ─────────────────────────────────────────────────────────
      let lastSel: string | null = null;
      const deskOfAgent = new Map(office.agents.map((a) => [a.deskId, a.id]));
      const computeBusySig = () =>
        Array.from(busyRef.current).sort().join(",");
      const computeStatusSig = () =>
        Array.from(statusRef.current.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join(",");
      lastBusySigRef.current = "";
      lastStatusSigRef.current = "";

      let bobPhase = 0;

      // ── Drag state ────────────────────────────────────────────────────────
      // Tracks the agent being repositioned via Pixi pointer events.
      type DragState = {
        deskId: string;
        body: InstanceType<typeof AnimatedSprite>;
        origX: number;
        origY: number;
        startPointerX: number;
        startPointerY: number;
        started: boolean; // true once we've passed the 4px grace threshold
      };
      let drag: DragState | null = null;
      // HTML5 drag-drop guard: if a task drag is in progress, pixi drag is blocked
      let htmlDragActive = false;
      const onHtmlDragStart = () => { htmlDragActive = true; };
      const onHtmlDragEnd = () => { htmlDragActive = false; };
      document.addEventListener("dragstart", onHtmlDragStart);
      document.addEventListener("dragend", onHtmlDragEnd);

      // Ghost: a translucent rectangle previewing where the agent will snap
      const ghost = new Graphics();
      ghost.visible = false;
      ghost.zIndex = 9999;
      furniture.addChild(ghost);

      const paintGhost = (valid: boolean) => {
        ghost.clear();
        ghost
          .rect(0, 0, tw, th)
          .fill({ color: valid ? 0x00ff88 : 0xff4444, alpha: 0.35 })
          .stroke({ color: valid ? 0x00ff88 : 0xff4444, width: 2, alpha: 0.8 });
      };

      // Attach drag handlers to each agent body after agents are created
      for (const [agentId, sprites] of agentSprites) {
        const agent = office.agents.find((a) => a.id === agentId);
        if (!agent) continue;

        ((body: InstanceType<typeof AnimatedSprite>, deskId: string) => {
          body.on("pointerdown", (ev) => {
            if (htmlDragActive) return;
            ev.stopPropagation();
            const gpos = ev.global;
            drag = {
              deskId,
              body,
              origX: body.x,
              origY: body.y,
              startPointerX: gpos.x,
              startPointerY: gpos.y,
              started: false,
            };
            body.cursor = "grabbing";
          });
        })(sprites.body, agent.deskId);
      }

      app.stage.eventMode = "static";
      app.stage.on("pointermove", (ev) => {
        if (!drag) return;
        const gpos = ev.global;
        const dx = gpos.x - drag.startPointerX;
        const dy = gpos.y - drag.startPointerY;

        if (!drag.started) {
          if (Math.sqrt(dx * dx + dy * dy) < 4) return;
          drag.started = true;
        }

        // Follow pointer in world coords
        const worldPos = world.toLocal(gpos);
        drag.body.position.set(worldPos.x, worldPos.y);
        // Drag the name tag along with the body
        const draggedAgentId = deskOfAgent.get(drag.deskId);
        if (draggedAgentId) {
          const sprites = agentSprites.get(draggedAgentId);
          if (sprites) {
            sprites.nameTag.position.set(
              worldPos.x,
              worldPos.y - drag.body.height - 18,
            );
          }
        }

        // Compute snapped grid cell
        const snapGX = Math.floor(worldPos.x / tw);
        const snapGY = Math.floor(worldPos.y / th);
        const inBounds =
          snapGX >= 0 && snapGX < office.grid.cols && snapGY >= 0 && snapGY < office.grid.rows;
        const occupied = inBounds
          ? office.desks.some((d) => d.id !== drag!.deskId && d.gridX === snapGX && d.gridY === snapGY)
          : false;
        const valid = inBounds && !occupied;

        ghost.position.set(snapGX * tw, snapGY * th);
        ghost.visible = true;
        paintGhost(valid);
      });

      const repositionNameTag = (deskId: string, bodyX: number, bodyY: number, bodyH: number) => {
        const aid = deskOfAgent.get(deskId);
        if (!aid) return;
        const sprites = agentSprites.get(aid);
        if (!sprites) return;
        sprites.nameTag.position.set(bodyX, bodyY - bodyH - 18);
      };

      app.stage.on("pointerup", (ev) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        ghost.visible = false;

        if (!d.started) {
          // Never moved past threshold — treat as a click; restore position
          d.body.position.set(d.origX, d.origY);
          repositionNameTag(d.deskId, d.origX, d.origY, d.body.height);
          d.body.cursor = "pointer";
          return;
        }

        const worldPos = world.toLocal(ev.global);
        const snapGX = Math.floor(worldPos.x / tw);
        const snapGY = Math.floor(worldPos.y / th);
        const inBounds =
          snapGX >= 0 && snapGX < office.grid.cols && snapGY >= 0 && snapGY < office.grid.rows;
        const occupied = inBounds
          ? office.desks.some((dd) => dd.id !== d.deskId && dd.gridX === snapGX && dd.gridY === snapGY)
          : false;

        if (!inBounds || occupied) {
          // Snap back to original position
          d.body.position.set(d.origX, d.origY);
          repositionNameTag(d.deskId, d.origX, d.origY, d.body.height);
          d.body.cursor = "pointer";
          return;
        }

        // Snap body to new cell center
        const newX = snapGX * tw + tw / 2;
        const newY = snapGY * th + th * 0.75;
        d.body.position.set(newX, newY);
        repositionNameTag(d.deskId, newX, newY, d.body.height);
        d.body.cursor = "pointer";

        // Update in-memory desk so geomRef and future drags are accurate
        const liveDesk = office.desks.find((dd) => dd.id === d.deskId);
        if (liveDesk) {
          liveDesk.gridX = snapGX;
          liveDesk.gridY = snapGY;
        }

        onAgentMoveRef.current?.(d.deskId, snapGX, snapGY);
      });

      app.stage.on("pointerupoutside", () => {
        if (!drag) return;
        const d = drag;
        drag = null;
        ghost.visible = false;
        d.body.position.set(d.origX, d.origY);
        repositionNameTag(d.deskId, d.origX, d.origY, d.body.height);
        d.body.cursor = "pointer";
      });

      const onTick = () => {
        // Sync grid overlay visibility
        gridOverlay.visible = showGridRef.current;

        if (selectedRef.current !== lastSel) {
          lastSel = selectedRef.current;
          for (const [id, g] of deskShapes) {
            if (premadeRoomConfig || tilesheet) {
              // premadeRoom / tilesheet mode: make the hit rect semi-visible only when selected
              g.alpha = id === lastSel ? 0.5 : 0;
            } else {
              paintDesk(g, id === lastSel);
            }
          }
        }

        const statusSig = computeStatusSig();
        const busySig = computeBusySig();
        const statusChanged = statusSig !== lastStatusSigRef.current;
        const busyChanged = busySig !== lastBusySigRef.current;

        if (statusChanged || busyChanged) {
          lastStatusSigRef.current = statusSig;
          lastBusySigRef.current = busySig;
          for (const [deskId, agentId] of deskOfAgent) {
            const sprites = agentSprites.get(agentId);
            if (!sprites) continue;
            const kind = statusRef.current.get(deskId);
            const busy = busyRef.current.has(deskId);
            sprites.exclamation.visible = kind === "awaiting_input";
            sprites.check.visible = kind === "done_unacked";
            // Hide pip when an indicator is active to avoid visual stacking
            sprites.pip.visible = busy && !kind;
          }
        }

        // Gentle bob for any visible indicator
        bobPhase += 0.06 * app.ticker.deltaTime;
        const bob = Math.sin(bobPhase) * 3;
        for (const { exclamation, check, indicatorBaseY } of agentSprites.values()) {
          if (exclamation.visible) exclamation.y = indicatorBaseY + bob;
          if (check.visible) check.y = indicatorBaseY + bob;
        }
      };
      app.ticker.add(onTick);

      cleanup = () => {
        app.ticker.remove(onTick);
        app.renderer.off("resize", center);
        document.removeEventListener("dragstart", onHtmlDragStart);
        document.removeEventListener("dragend", onHtmlDragEnd);
        // Stop all AnimatedSprites before destroying to avoid ticker callbacks on destroyed sprites
        for (const { body } of agentSprites.values()) {
          body.stop();
        }
        app.destroy(true, { children: true });
        geomRef.current.canvas = null;
      };
    })();

    return () => {
      destroyed = true;
      cleanup?.();
    };
  }, [office]);

  // Hit-test for HTML drag-drop events
  const hitTestDesk = (clientX: number, clientY: number): string | null => {
    const { canvas, worldX, worldY, tw, th, desks } = geomRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;

    // Convert to world coords, then to grid cell (flat top-down)
    const wx = px - worldX;
    const wy = py - worldY;
    const gx = Math.floor(wx / tw);
    const gy = Math.floor(wy / th);

    // Exact cell match first, then nearest desk within 1 cell radius
    let best: { id: string; d: number } | null = null;
    for (const desk of desks) {
      const dx = gx - desk.gridX;
      const dy = gy - desk.gridY;
      const d = Math.abs(dx) + Math.abs(dy); // Manhattan distance in grid cells
      if (d <= 1 && (!best || d < best.d)) best = { id: desk.id, d };
    }
    return best?.id ?? null;
  };

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (!onDeskDrop) return;
    if (e.dataTransfer.types.includes("application/x-robot-task")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (!onDeskDrop) return;
    const hasTask = e.dataTransfer.types.includes("application/x-robot-task");
    if (!hasTask) return;
    e.preventDefault();
    const deskId = hitTestDesk(e.clientX, e.clientY);
    if (deskId) onDeskDrop(deskId, e);
  };

  return (
    <div className="relative w-full h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  );
}
