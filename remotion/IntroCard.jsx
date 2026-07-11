import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from 'remotion';

const NICHE_FONT = "'Arial', sans-serif";

/** A short (2.5s) animated title card: niche label slides in, then the
 * video title scales/fades in with a spring, over an animated gradient. */
export function IntroCard({ title, niche, accentColor = '#e63946' }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const gradientAngle = interpolate(frame, [0, fps * 2.5], [0, 25]);

  const nicheOpacity = interpolate(frame, [0, fps * 0.4], [0, 1], { extrapolateRight: 'clamp' });
  const nicheY = interpolate(frame, [0, fps * 0.4], [20, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  const titleSpring = spring({ frame: frame - fps * 0.3, fps, config: { damping: 14, stiffness: 120, mass: 0.8 } });
  const titleScale = interpolate(titleSpring, [0, 1], [0.85, 1]);
  const titleOpacity = interpolate(frame, [fps * 0.3, fps * 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const barWidth = interpolate(frame, [fps * 0.6, fps * 1.1], [0, width * 0.4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

  const fontScale = width > height ? 1 : 0.72;

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${135 + gradientAngle}deg, #0f0f1a, ${accentColor}22, #0f0f1a)`,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: NICHE_FONT
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8%' }}>
        <div
          style={{
            opacity: nicheOpacity,
            transform: `translateY(${nicheY}px)`,
            color: accentColor,
            fontSize: 32 * fontScale,
            fontWeight: 700,
            letterSpacing: 6,
            textTransform: 'uppercase',
            marginBottom: 24
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
            textShadow: '0 4px 24px rgba(0,0,0,0.5)'
          }}
        >
          {title}
        </div>
        <div style={{ width: barWidth, height: 5, background: accentColor, borderRadius: 3, marginTop: 32 }} />
      </div>
    </AbsoluteFill>
  );
}
