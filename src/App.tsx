import { Route, Routes } from "react-router-dom";
import { TranscriptionJobProvider } from "./context/TranscriptionJobContext";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Transcribe } from "./pages/Transcribe";
import { Library } from "./pages/Library";
import { TranscriptDetail } from "./pages/TranscriptDetail";
import { GroupList } from "./pages/GroupList";
import { NewGroupingSession } from "./pages/NewGroupingSession";
import { GroupingSessionDetail } from "./pages/GroupingSessionDetail";
import { TopicList } from "./pages/TopicList";
import { NewTopicQuery } from "./pages/NewTopicQuery";
import { TopicQueryDetail } from "./pages/TopicQueryDetail";
import "./App.css";

function App() {
  return (
    <TranscriptionJobProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="transcribe" element={<Transcribe />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:id" element={<TranscriptDetail />} />
          <Route path="group" element={<GroupList />} />
          <Route path="group/new" element={<NewGroupingSession />} />
          <Route path="group/:id" element={<GroupingSessionDetail />} />
          <Route path="topics" element={<TopicList />} />
          <Route path="topics/new" element={<NewTopicQuery />} />
          <Route path="topics/:id" element={<TopicQueryDetail />} />
        </Route>
      </Routes>
    </TranscriptionJobProvider>
  );
}

export default App;
