import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface Plan {
  id: string;
  name: string;
  uploaded_at: string;
  is_active: number;
  start_date: string;
}

export default function Plans() {
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [activationDate, setActivationDate] = useState(new Date().toISOString().split('T')[0]);

  const fetchPlans = async () => {
    const res = await fetch('http://localhost:3000/api/plan');
    const data = await res.json();
    setPlans(data);
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleFileUpload = async () => {
    if (!file) return;
    setStatus(t('plans.uploading_status'));
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch('http://localhost:3000/api/plan/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) {
      setStatus(`Error: ${data.error}`);
    } else {
      setStatus(t('plans.uploaded_status', { count: data.workoutCount }));
      fetchPlans();
      setFile(null);
    }
  };

  const handleActivate = async (id: string) => {
    setStatus(t('plans.activating_status'));
    const res = await fetch(`http://localhost:3000/api/plan/activate/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: activationDate })
    });
    const data = await res.json();
    if (data.success) {
      setStatus(t('plans.activated_status'));
      fetchPlans();
    } else {
      setStatus(t('plans.failed_activate'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('plans.delete_confirm'))) return;
    setStatus(t('plans.deleting_status'));
    const res = await fetch(`http://localhost:3000/api/plan/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      setStatus(t('plans.deleted_status'));
      fetchPlans();
    } else {
      setStatus(t('plans.failed_delete'));
    }
  };

  return (
    <div className="plans-container">
      <div className="glass-card" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h1>{t('plans.manage_plans')}</h1>
        <p>{t('plans.upload_msg')}</p>
        
        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input 
            type="file" 
            accept=".csv, .tsv"
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ color: 'white' }}
          />
          <button className="btn" onClick={handleFileUpload} disabled={!file}>{t('plans.upload_btn')}</button>
        </div>
      </div>

      {status && (
        <div className="glass-card" style={{ padding: '1rem', marginBottom: '2rem', background: 'rgba(0, 255, 157, 0.1)', color: 'var(--accent-color)', textAlign: 'center' }}>
          {status}
        </div>
      )}

      <div className="plans-grid" style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {plans.map(plan => (
          <div key={plan.id} className={`glass-card plan-card ${plan.is_active ? 'active' : ''}`} style={{ 
            padding: '1.5rem', 
            position: 'relative',
            border: plan.is_active ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)'
          }}>
            {plan.is_active === 1 && (
              <span style={{ 
                position: 'absolute', 
                top: '-10px', 
                right: '20px', 
                background: 'var(--accent-color)', 
                color: 'black', 
                padding: '2px 10px', 
                borderRadius: '10px',
                fontSize: '0.8rem',
                fontWeight: 'bold'
              }}>{t('plans.active')}</span>
            )}
            <h3 style={{ margin: '0 0 0.5rem 0' }}>{plan.name}</h3>
            <p style={{ fontSize: '0.9rem', color: '#ccc', marginBottom: '1rem' }}>
              {t('plans.uploaded_on', { date: new Date(plan.uploaded_at).toLocaleDateString(i18n.language) })}
            </p>
            
            {plan.is_active === 1 ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{t('plans.start_date')}: {plan.start_date}</p>
              </div>
            ) : (
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{t('plans.set_start_date')}</label>
                <input 
                  type="date" 
                  value={activationDate}
                  onChange={e => setActivationDate(e.target.value)}
                  style={{ 
                    width: '100%', 
                    padding: '8px', 
                    borderRadius: '4px', 
                    background: 'var(--bg-color)', 
                    color: 'white', 
                    border: '1px solid var(--glass-border)' 
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!plan.is_active && (
                <button className="btn" style={{ flex: 1 }} onClick={() => handleActivate(plan.id)}>{t('plans.activate')}</button>
              )}
              <button className="btn btn-danger" style={{ background: 'rgba(255, 68, 68, 0.2)', color: '#ff4444' }} onClick={() => handleDelete(plan.id)}>{t('plans.delete')}</button>
            </div>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#888' }}>
          {t('plans.no_plans')}
        </div>
      )}
    </div>
  );
}
