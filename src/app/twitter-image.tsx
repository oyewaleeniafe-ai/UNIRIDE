import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

export const alt = 'Campus Cab — University Ride-Hailing Platform';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #1a56db 0%, #1e3a8a 50%, #0f172a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.08,
            background:
              'radial-gradient(circle at 25% 25%, white 1px, transparent 1px), radial-gradient(circle at 75% 75%, white 1px, transparent 1px)',
            backgroundSize: '50px 50px',
          }}
        />

        <div
          style={{
            width: '90px',
            height: '90px',
            borderRadius: '20px',
            background: 'rgba(255,255,255,0.15)',
            border: '3px solid rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
          }}
        >
          <span
            style={{
              fontSize: '48px',
              fontWeight: '900',
              color: 'white',
              letterSpacing: '-2px',
            }}
          >
            CC
          </span>
        </div>

        <div
          style={{
            fontSize: '56px',
            fontWeight: '800',
            color: 'white',
            textAlign: 'center',
            letterSpacing: '-1.5px',
            lineHeight: 1.1,
            marginBottom: '12px',
          }}
        >
          Campus Cab
        </div>

        <div
          style={{
            fontSize: '24px',
            fontWeight: '500',
            color: 'rgba(147,197,253,1)',
            textAlign: 'center',
            marginBottom: '32px',
          }}
        >
          University Ride-Hailing Platform
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '40px' }}>
          {['🚕 Solo Cab', '🚐 Shared Shuttle', '🛡️ SOS Safety', '📍 Live Tracking'].map(
            (feature) => (
              <div
                key={feature}
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '24px',
                  padding: '8px 18px',
                  fontSize: '15px',
                  fontWeight: '600',
                  color: 'rgba(255,255,255,0.9)',
                }}
              >
                {feature}
              </div>
            ),
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: '28px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            color: 'rgba(148,163,184,1)',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#4ade80',
              display: 'flex',
            }}
          />
          Book rides across campus — free for students
        </div>
      </div>
    ),
    { ...size },
  );
}
