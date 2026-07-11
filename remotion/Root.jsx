import React from 'react';
import { Composition } from 'remotion';
import { IntroCard } from './IntroCard.jsx';

const FPS = 25; // matches the fps used throughout lib/visuals.js and lib/assemble.js
const DURATION_IN_FRAMES = Math.round(FPS * 2.8);

const defaultProps = {
  title: 'Video Title',
  niche: 'Niche Name',
  accentColor: '#e63946'
};

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="IntroCardLandscape"
        component={IntroCard}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />
      <Composition
        id="IntroCardVertical"
        component={IntroCard}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
    </>
  );
}
