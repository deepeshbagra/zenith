import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { generateRoomCode } from "../service/roomCode";
import { MAX_PARTICIPANTS } from "../service/MeshSession";
import "./Meetings.css";

const MeetingsPage = () => {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState(null);
  
  // Form states
  const [formData, setFormData] = useState({
    title: "",
    date: "",
    time: "",
    duration: "30",
    participants: "2"
  });

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  // Load meetings from localStorage
  useEffect(() => {
    const savedMeetings = localStorage.getItem("zenith_meetings");
    if (savedMeetings) {
      setMeetings(JSON.parse(savedMeetings));
    }
  }, []);

  // Save meetings to localStorage
  const saveMeetings = (updatedMeetings) => {
    localStorage.setItem("zenith_meetings", JSON.stringify(updatedMeetings));
    setMeetings(updatedMeetings);
  };

  // Calendar functions
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Previous month days
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    
    return days;
  };

  const formatMonthYear = (date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const isSameDay = (date1, date2) => {
    if (!date1 || !date2) return false;
    return date1.toDateString() === date2.toDateString();
  };

  const isToday = (date) => {
    if (!date) return false;
    return isSameDay(date, new Date());
  };

  const isPastDate = (date) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const handleDateSelect = (date) => {
    if (!isPastDate(date)) {
      setSelectedDate(date);
      setFormData(prev => ({
        ...prev,
        date: date.toISOString().split('T')[0]
      }));
    }
  };

  const previousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  // Open schedule modal
  const openScheduleModal = () => {
    setEditingMeeting(null);
    setFormData({
      title: "",
      date: "",
      time: "",
      duration: "30",
      participants: "2"
    });
    setSelectedDate(null);
    setShowScheduleModal(true);
  };

  // Open edit modal
  const openEditModal = (meeting) => {
    setEditingMeeting(meeting);
    setFormData({
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      duration: meeting.duration,
      participants: meeting.participants
    });
    const dateObj = new Date(meeting.date + 'T00:00:00');
    setSelectedDate(dateObj);
    setCurrentMonth(dateObj);
    setShowScheduleModal(true);
  };

  // Handle form input
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Schedule/Update meeting
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.title || !formData.date || !formData.time) {
      alert("Please fill in all required fields");
      return;
    }

    if (editingMeeting) {
      // Update existing meeting
      const updatedMeetings = meetings.map(m =>
        m.id === editingMeeting.id
          ? { ...editingMeeting, ...formData }
          : m
      );
      saveMeetings(updatedMeetings);
    } else {
      // Create new meeting
      const newMeeting = {
        id: Date.now(),
        ...formData,
        roomCode: generateRoomCode(),
        createdAt: new Date().toISOString()
      };
      saveMeetings([...meetings, newMeeting]);
    }

    setShowScheduleModal(false);
    setFormData({
      title: "",
      date: "",
      time: "",
      duration: "30",
      participants: "2"
    });
    setSelectedDate(null);
  };

  // Delete meeting
  const handleDelete = (meetingId) => {
    if (window.confirm("Are you sure you want to delete this meeting?")) {
      const updatedMeetings = meetings.filter(m => m.id !== meetingId);
      saveMeetings(updatedMeetings);
      setShowScheduleModal(false);
    }
  };

  // Join meeting
  const handleJoinMeeting = (roomCode) => {
    navigate(`/preview/${roomCode}`);
  };

  // Format date for display
  const formatDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (isSameDay(date, today)) return "Today";
    if (isSameDay(date, tomorrow)) return "Tomorrow";
    
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  // Format time
  const formatTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Separate upcoming and past meetings
  const now = new Date();
  const upcomingMeetings = meetings
    .filter(m => {
      const meetingDateTime = new Date(m.date + 'T' + m.time);
      return meetingDateTime >= now;
    })
    .sort((a, b) => {
      const dateA = new Date(a.date + 'T' + a.time);
      const dateB = new Date(b.date + 'T' + b.time);
      return dateA - dateB;
    });

  const pastMeetings = meetings
    .filter(m => {
      const meetingDateTime = new Date(m.date + 'T' + m.time);
      return meetingDateTime < now;
    })
    .sort((a, b) => {
      const dateA = new Date(a.date + 'T' + a.time);
      const dateB = new Date(b.date + 'T' + b.time);
      return dateB - dateA;
    });

  return (
    <div className="meetings-page">
      <div className="meetings-header">
        <div>
          <h1 className="page-title">Meetings</h1>
          <p className="page-subtitle">Schedule and manage your video conferences</p>
        </div>
        <button onClick={openScheduleModal} className="btn-schedule-meeting">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Schedule Meeting
        </button>
      </div>

      {/* Upcoming Meetings */}
      <div className="meetings-section">
        <div className="section-header">
          <h2>Upcoming Meetings</h2>
          <p>Your scheduled video calls</p>
        </div>

        {upcomingMeetings.length === 0 ? (
          <div className="empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h3>No upcoming meetings</h3>
            <p>Schedule your first meeting to get started</p>
          </div>
        ) : (
          <div className="meetings-list">
            {upcomingMeetings.map(meeting => (
              <div key={meeting.id} className="meeting-card">
                <div className="meeting-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="meeting-info">
                  <h3>{meeting.title}</h3>
                  <div className="meeting-details">
                    <span className="detail-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {formatDate(meeting.date)}, {formatTime(meeting.time)}
                    </span>
                    <span className="detail-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      {meeting.participants} people
                    </span>
                    <span className="detail-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {meeting.duration} min
                    </span>
                  </div>
                </div>
                <div className="meeting-actions">
                  <button 
                    onClick={() => handleJoinMeeting(meeting.roomCode)}
                    className="btn-join-meeting"
                  >
                    Join
                  </button>
                  <button 
                    onClick={() => openEditModal(meeting)}
                    className="btn-edit-meeting"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Past Meetings */}
      {pastMeetings.length > 0 && (
        <div className="meetings-section">
          <div className="section-header">
            <h2>Past Meetings</h2>
            <p>Your meeting history</p>
          </div>

          <div className="meetings-list">
            {pastMeetings.map(meeting => (
              <div key={meeting.id} className="meeting-card past-meeting">
                <div className="meeting-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="meeting-info">
                  <h3>{meeting.title}</h3>
                  <div className="meeting-details">
                    <span className="detail-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {formatDate(meeting.date)}, {formatTime(meeting.time)}
                    </span>
                    <span className="detail-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      {meeting.participants} people
                    </span>
                    <span className="detail-item">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {meeting.duration} min
                    </span>
                  </div>
                </div>
                <div className="meeting-actions">
                  <button 
                    onClick={() => handleDelete(meeting.id)}
                    className="btn-delete-meeting"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule/Edit Modal */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-content schedule-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingMeeting ? "Edit Meeting" : "Schedule Meeting"}</h2>
              <button className="modal-close" onClick={() => setShowScheduleModal(false)}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="modal-body schedule-modal-body">
              <form onSubmit={handleSubmit} className="schedule-form">
                <div className="form-group">
                  <label>Meeting Title *</label>
                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleInputChange}
                    placeholder="e.g., Team Standup"
                    className="form-input"
                    required
                  />
                </div>

                {/* Calendar */}
                <div className="form-group">
                  <label>Select Date *</label>
                  <div className="calendar-widget">
                    <div className="calendar-header">
                      <button type="button" onClick={previousMonth} className="calendar-nav">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="calendar-month">{formatMonthYear(currentMonth)}</span>
                      <button type="button" onClick={nextMonth} className="calendar-nav">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                    <div className="calendar-weekdays">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <div key={day} className="weekday">{day}</div>
                      ))}
                    </div>
                    <div className="calendar-days">
                      {getDaysInMonth(currentMonth).map((date, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => date && handleDateSelect(date)}
                          disabled={!date || isPastDate(date)}
                          className={`calendar-day ${!date ? 'empty' : ''} ${
                            isToday(date) ? 'today' : ''
                          } ${
                            isSameDay(date, selectedDate) ? 'selected' : ''
                          } ${
                            isPastDate(date) ? 'past' : ''
                          }`}
                        >
                          {date ? date.getDate() : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Time *</label>
                    <input
                      type="time"
                      name="time"
                      value={formData.time}
                      onChange={handleInputChange}
                      className="form-input"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Duration</label>
                    <select
                      name="duration"
                      value={formData.duration}
                      onChange={handleInputChange}
                      className="form-input"
                    >
                      <option value="15">15 min</option>
                      <option value="30">30 min</option>
                      <option value="45">45 min</option>
                      <option value="60">60 min</option>
                      <option value="90">90 min</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Expected Participants</label>
                  <input
                    type="number"
                    name="participants"
                    value={formData.participants}
                    onChange={handleInputChange}
                    min="2"
                    // Capped at the real room limit. It used to allow 100,
                    // which let you schedule a meeting the app cannot host.
                    max={MAX_PARTICIPANTS}
                    className="form-input"
                  />
                  <p className="form-hint">
                    Rooms hold up to {MAX_PARTICIPANTS} people.
                  </p>
                </div>

                <div className="modal-footer">
                  {editingMeeting && (
                    <button
                      type="button"
                      onClick={() => handleDelete(editingMeeting.id)}
                      className="btn-delete"
                    >
                      Delete Meeting
                    </button>
                  )}
                  <div className="footer-actions">
                    <button
                      type="button"
                      onClick={() => setShowScheduleModal(false)}
                      className="btn-cancel"
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn-submit">
                      {editingMeeting ? "Update Meeting" : "Schedule Meeting"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingsPage;