declare module 'lottie-web/build/player/esm/lottie_light.min.js' {
  export interface LottieInstance {
    destroy(): void;
    play(): void;
    stop(): void;
    setSpeed(speed: number): void;
  }

  export interface LoadAnimationParams {
    container: Element;
    renderer?: 'svg' | 'canvas' | 'html';
    loop?: boolean;
    autoplay?: boolean;
    animationData: Record<string, unknown>;
  }

  const lottieLight: {
    loadAnimation(params: LoadAnimationParams): LottieInstance;
  };

  export default lottieLight;
}
