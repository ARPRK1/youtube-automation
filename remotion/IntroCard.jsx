import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from 'remotion';

const NICHE_FONT = "'Arial', sans-serif";

// Fixed brand identity so every video opens with the same recognizable
// mark and motion regardless of the day's topic/niche -- consistency is
// the whole point of a bumper. accentColor (hashed per-topic in
// orchestrator.js) still tints the background gradient so videos don't
// look identically stamped, but the mark itself never changes.
const BRAND_COLOR = '#4f8cff';

/** The recurring "channel mark": a rotating dashed ring around a pulsing
 * core dot. Same shape and motion in every video -- this is the piece
 * meant to become recognizable over time, independent of any single
 * video's topic or accent color. Pure SVG/CSS, no external assets. */
function BrandMark({ frame, fps, size }) {
  const rotation = (frame / fps) * 40; // slow constant spin, degrees/sec
  const pulse = 1 + 0.08 * Math.sin((frame / fps) * Math.PI * 2 * 1.2);
  const entrance = spring({ frame, fps, config: { damping: 12, stiffness: 100, mass: 0.6 } });

  return (
    <div style={{ transform: `scale(${entrance})`, marginBottom: 28 }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke={BRAND_COLOR}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="60 40"
          transform={`rotate(${rotation} 50 50)`}
          opacity={0.9}
        />
        <circle
          cx="50" cy="50" r="30"
          fill="none"
          stroke={BRAND_COLOR}
          strokeWidth="1.5"
          strokeDasharray="4 6"
          transform={`rotate(${-rotation * 0.6} 50 50)`}
          opacity={0.5}
        />
        <circle cx="50" cy="50" r={10 * pulse} fill={BRAND_COLOR} opacity={0.95} />
      </svg>
    </div>
  );
}

/** A short (~2.8s) animated title card: brand mark spins in, niche label
 * slides in, then the video title scales/fades in with a spring, over an
 * animated gradient bright enough to read clearly as a real scene (not a
 * near-black frame -- a prior version's background was dark enough,
 * edge-to-edge, that ffmpeg's blackdetect flagged the entire intro as a
 * black-frame gap and failed the quality gate on it, confirmed live: the
 * gap length matched this composition's duration exactly). */
export function IntroCard({ title, niche, accentColor = '#e63946' }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const gradientAngle = interpolate(frame, [0, fps * 2.5], [0, 25]);

  const nicheOpacity = interpolate(frame, [fps * 0.5, fps * 0.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const nicheY = interpolate(frame, [fps * 0.5, fps * 0.9], [20, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  const titleSpring = spring({ frame: frame - fps * 0.8, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const titleScale = interpolate(titleSpring, [0, 1], [0.85, 1]);
  const titleOpacity = interpolate(frame, [fps * 0.8, fps * 1.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const barWidth = interpolate(frame, [fps * 1.3, fps * 1.8], [0, width * 0.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  const fontScale = width > height ? 1 : 0.72;
  const markSize = (width > height ? 90 : 100) * fontScale;

  return (
    <AbsoluteFill
      style={{
        // Bright, saturated base (not a near-black one) so the frame reads
        // as real content to both viewers and automated black-frame checks.
        background: `linear-gradient(${135 + gradientAngle}deg, #2b2560, ${accentColor}, #1e3a5f)`,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: NICHE_FONT
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8%' }}>
        <BrandMark frame={frame} fps={fps} size={markSize} />
        <div
          style={{
            opacity: nicheOpacity,
            transform: `translateY(${nicheY}px)`,
            color: '#ffffff',
            fontSize: 32 * fontScale,
            fontWeight: 700,
            letterSpacing: 6,
            textTransform: 'uppercase',
            marginBottom: 24,
            textShadow: '0 2px 12px rgba(0,0,0,0.6)'
          }}
        >
          {niche}
        </div>
        <div
          style={{
            opacity: titleOpacity,
            transform: `scale(${titleScale})`,
            color: '#ffffff',
            fontSize: 64 * fontScale,
            fontWeight: 800,
            textAlign: 'center',
            lineHeight: 1.15,
            textShadow: '0 4px 24px rgba(0,0,0,0.6)'
          }}
        >
          {title}
        </div>
        <div style={{ width: barWidth, height: 5, background: '#ffffff', borderRadius: 3, marginTop: 32 }} />
      </div>
    </AbsoluteFill>
  );
}
