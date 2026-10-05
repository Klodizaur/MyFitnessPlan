import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setTvNavigate } from '../lib/tv';

/** Rendered only in TV mode: lets the remote's Back button use the router. */
export default function TvRouteSync() {
  const navigate = useNavigate();
  useEffect(() => {
    setTvNavigate(to => (typeof to === 'number' ? navigate(to) : navigate(to)));
    return () => setTvNavigate(null);
  }, [navigate]);
  return null;
}
