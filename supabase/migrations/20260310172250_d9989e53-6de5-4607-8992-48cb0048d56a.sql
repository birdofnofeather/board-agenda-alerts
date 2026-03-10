-- Create enum for cluster types
CREATE TYPE public.cluster_type AS ENUM (
  'operations',
  'community_services',
  'family_social_services',
  'health_mental_health'
);

-- Table for meetings/agendas
CREATE TABLE public.meetings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cluster cluster_type NOT NULL,
  meeting_date DATE NOT NULL,
  meeting_time TEXT,
  agenda_pdf_url TEXT NOT NULL,
  teams_link TEXT,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(cluster, meeting_date)
);

-- Table for board motion items extracted from agendas
CREATE TABLE public.board_motions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  item_number TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  backup_page_anchor TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_motions ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can view meetings" ON public.meetings FOR SELECT USING (true);
CREATE POLICY "Anyone can view board motions" ON public.board_motions FOR SELECT USING (true);

-- Allow insert/update/delete for all (simple app, no admin auth)
CREATE POLICY "Anyone can insert meetings" ON public.meetings FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update meetings" ON public.meetings FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete meetings" ON public.meetings FOR DELETE USING (true);
CREATE POLICY "Anyone can insert board motions" ON public.board_motions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update board motions" ON public.board_motions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete board motions" ON public.board_motions FOR DELETE USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_board_motions_updated_at
  BEFORE UPDATE ON public.board_motions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();