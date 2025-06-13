
// src/components/kanban/KanbanBoardView.tsx
"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { KanbanBoard } from './KanbanBoard';
import { TaskDetailsModal } from '../modals/TaskDetailsModal';
import { Button } from '@/components/ui/button';
import type { Board, Task, Column as ColumnType, UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Loader2 } from 'lucide-react';
import { getBoardById, updateBoard } from '@/services/boardService';
import { getTasksByBoard, createTask, updateTask as updateTaskService, deleteTask } from '@/services/taskService';
import { getUsersByIds } from '@/services/userService';

const DEFAULT_NEW_TASK_TITLE = 'New Task';

export function KanbanBoardView({ boardId }: { boardId: string | null }) {
  const { user } = useAuth();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentBoard, setCurrentBoard] = useState<Board | null>(null);
  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile | null>>({});
  const provisionalNewTaskIdRef = useRef<string | null>(null);
  const { toast } = useToast();

  const [isAddingColumn, setIsAddingColumn] = useState(false);

  const fetchBoardData = useCallback(async (id: string) => {
    if (!user) return;
    setIsLoadingBoard(true);
    setUserProfiles({});
    setIsAddingColumn(false);
    try {
      const boardData = await getBoardById(id);
      if (boardData && boardData.ownerId === user.id) {
        setCurrentBoard(boardData);
        const tasksData = await getTasksByBoard(id);
        setBoardTasks(tasksData.map(task => ({...task, isCompleted: task.isCompleted || false}))); // Ensure isCompleted defaults to false

        const allUserIds = new Set<string>();
        tasksData.forEach(task => {
          if (task.creatorId) allUserIds.add(task.creatorId);
        });
        if (allUserIds.size > 0) {
          const profiles = await getUsersByIds(Array.from(allUserIds));
          const profilesMap: Record<string, UserProfile | null> = {};
          profiles.forEach(p => profilesMap[p.id] = p);
          setUserProfiles(profilesMap);
        }
      } else if (boardData) {
        toast({ title: "Access Denied", description: "You do not have permission to view this board.", variant: "destructive" });
        setCurrentBoard(null); setBoardTasks([]);
      } else {
        toast({ title: "Board Not Found", description: "The requested board does not exist.", variant: "destructive" });
        setCurrentBoard(null); setBoardTasks([]);
      }
    } catch (error) {
      console.error("Error fetching board data:", error);
      toast({ title: "Error", description: "Could not load board data.", variant: "destructive" });
    } finally {
      setIsLoadingBoard(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (boardId) {
      fetchBoardData(boardId);
    } else {
      setCurrentBoard(null);
      setBoardTasks([]);
      setUserProfiles({});
      setIsAddingColumn(false);
    }
  }, [boardId, fetchBoardData]);

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const deleteProvisionalTask = async (taskIdToDelete: string) => {
    if (!currentBoard || !user) return;
    try {
      await deleteTask(taskIdToDelete);
      const updatedBoardColumns = currentBoard.columns.map(col => ({
        ...col,
        taskIds: col.taskIds.filter(id => id !== taskIdToDelete)
      }));
      setCurrentBoard(prevBoard => prevBoard ? { ...prevBoard, columns: updatedBoardColumns } : null);
      if (currentBoard) {
        await updateBoard(currentBoard.id, { columns: updatedBoardColumns });
      }
      setBoardTasks(prevTasks => prevTasks.filter(t => t.id !== taskIdToDelete));
      toast({ title: "New Task Discarded", description: "The empty new task was removed." });
    } catch (error) {
      console.error("Error deleting provisional task:", error);
      toast({ title: "Error", description: "Could not remove the provisional task.", variant: "destructive" });
      if (currentBoard) fetchBoardData(currentBoard.id);
    }
  };

  const handleCloseModal = () => {
    if (provisionalNewTaskIdRef.current && selectedTask && selectedTask.id === provisionalNewTaskIdRef.current) {
        const taskInBoardTasks = boardTasks.find(t => t.id === selectedTask.id);
        if (taskInBoardTasks && taskInBoardTasks.title === DEFAULT_NEW_TASK_TITLE && (!taskInBoardTasks.description || taskInBoardTasks.description.trim() === '')) {
            deleteProvisionalTask(selectedTask.id);
        }
    }
    provisionalNewTaskIdRef.current = null;
    setIsModalOpen(false);
    setSelectedTask(null);
  };

  const handleUpdateTask = async (updatedTask: Task) => {
    if (!user || !currentBoard) return;
    try {
      await updateTaskService(updatedTask.id, updatedTask);
      setBoardTasks(prevTasks => prevTasks.map(t => t.id === updatedTask.id ? updatedTask : t));

      if (provisionalNewTaskIdRef.current === updatedTask.id) {
        provisionalNewTaskIdRef.current = null;
      }

      if (updatedTask.creatorId && !userProfiles[updatedTask.creatorId]) {
        const profile = await getUsersByIds([updatedTask.creatorId]);
        if (profile.length > 0) {
          setUserProfiles(prev => ({ ...prev, [updatedTask.creatorId]: profile[0] }));
        }
      }
    } catch (error) {
      console.error("Error updating task:", error);
      throw error;
    }
  };

  const handleAddTask = async (columnId: string) => {
    if (!user || !currentBoard) {
      toast({ title: "Error", description: "Cannot add task without a selected board or user.", variant: "destructive" });
      return;
    }
    const targetColumn = currentBoard.columns.find(col => col.id === columnId) || currentBoard.columns[0];

    if (!targetColumn) {
        toast({ title: "Error", description: "Cannot add task: No columns available on the board.", variant: "destructive" });
        return;
    }

    const newTaskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'isCompleted'> = {
      title: DEFAULT_NEW_TASK_TITLE,
      description: '',
      priority: 'medium',
      subtasks: [],
      comments: [],
      boardId: currentBoard.id,
      columnId: targetColumn.id,
      creatorId: user.id,
      isArchived: false,
    };

    try {
      const createdTask = await createTask(newTaskData); // isCompleted will be false by default from service
      provisionalNewTaskIdRef.current = createdTask.id;
      setBoardTasks(prevTasks => [...prevTasks, createdTask]);
      const updatedBoardColumns = currentBoard.columns.map(col => {
        if (col.id === targetColumn.id) {
          return { ...col, taskIds: [...col.taskIds, createdTask.id] };
        }
        return col;
      });
      setCurrentBoard(prevBoard => prevBoard ? { ...prevBoard, columns: updatedBoardColumns } : null);

      handleTaskClick(createdTask);

      updateBoard(currentBoard.id, { columns: updatedBoardColumns })
         .catch(err => {
            console.error("Error updating board in background after task creation:", err);
            toast({title: "Board Update Error", description: "Could not save new task to board structure in background.", variant: "destructive"});
         });

      if (createdTask.creatorId && !userProfiles[createdTask.creatorId]) {
        getUsersByIds([createdTask.creatorId]).then(profile => {
          if (profile.length > 0) {
            setUserProfiles(prev => ({ ...prev, [createdTask.creatorId]: profile[0] }));
          }
        }).catch(profileError => console.error("Error fetching creator profile for new task:", profileError));
      }

    } catch (error) {
      console.error("Error creating task:", error);
      toast({ title: "Error Creating Task", description: "Failed to create new task.", variant: "destructive" });
    }
  };

  const handleAddColumn = async (columnName: string) => {
    if (!user || !currentBoard) {
      toast({ title: "Authentication Error", description: "Cannot add column without a selected board or user.", variant: "destructive" });
      setIsAddingColumn(false); 
      return;
    }

    const trimmedColumnName = columnName.trim();
    if (!trimmedColumnName) {
      toast({ title: "Invalid Column Name", description: "Column name cannot be empty.", variant: "destructive"});
      return; 
    }

    const newColumn: ColumnType = {
      id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: trimmedColumnName,
      taskIds: [],
    };

    const updatedColumns = [...currentBoard.columns, newColumn];
    try {
      await updateBoard(currentBoard.id, { columns: updatedColumns });
      setCurrentBoard(prevBoard => prevBoard ? { ...prevBoard, columns: updatedColumns } : null);
      toast({ title: "Column Added", description: `Column "${newColumn.name}" added successfully.` });
      setIsAddingColumn(false);
    } catch (error) {
      console.error("Error adding column to Firestore:", error);
      toast({ title: "Error Adding Column", description: "Failed to save the new column to the database.", variant: "destructive" });
      setIsAddingColumn(false);
    }
  };

 const handleTaskDrop = async (taskId: string, sourceColumnId: string, destinationColumnId: string, targetTaskId?: string) => {
    if (!currentBoard || !user) return;

    const taskToMove = boardTasks.find(t => t.id === taskId);
    if (!taskToMove) return;

    let newBoardColumns = JSON.parse(JSON.stringify(currentBoard.columns)) as ColumnType[];
    const sourceColIndex = newBoardColumns.findIndex(col => col.id === sourceColumnId);
    const destColIndex = newBoardColumns.findIndex(col => col.id === destinationColumnId);

    if (sourceColIndex === -1 || destColIndex === -1) {
        console.error("Source or destination column not found during drag and drop.");
        if (currentBoard) fetchBoardData(currentBoard.id);
        return;
    }

    if (sourceColumnId !== destinationColumnId) {
        setBoardTasks(prevTasks =>
            prevTasks.map(t => (t.id === taskId ? { ...t, columnId: destinationColumnId } : t))
        );
    }

    newBoardColumns[sourceColIndex].taskIds = newBoardColumns[sourceColIndex].taskIds.filter(id => id !== taskId);

    let destTaskIds = [...newBoardColumns[destColIndex].taskIds];
    const currentTaskIndexInDest = destTaskIds.indexOf(taskId); 
    if (currentTaskIndexInDest > -1) {
        destTaskIds.splice(currentTaskIndexInDest, 1); 
    }

    const targetIndexInDest = targetTaskId ? destTaskIds.indexOf(targetTaskId) : -1;

    if (sourceColumnId === destinationColumnId) { 
        if (targetIndexInDest !== -1) { 
            destTaskIds.splice(targetIndexInDest, 0, taskId);
        } else { 
            destTaskIds.push(taskId);
        }
    } else { 
        if (targetIndexInDest !== -1) { 
            destTaskIds.splice(targetIndexInDest, 0, taskId);
        } else { 
            destTaskIds.push(taskId);
        }
    }
    newBoardColumns[destColIndex].taskIds = destTaskIds;

    setCurrentBoard(prevBoard => (prevBoard ? { ...prevBoard, columns: newBoardColumns } : null));

    try {
        if (sourceColumnId !== destinationColumnId) {
            await updateTaskService(taskId, { columnId: destinationColumnId });
        }
        await updateBoard(currentBoard.id, { columns: newBoardColumns });
    } catch (error) {
        console.error("Error moving task:", error);
        toast({ title: "Error Moving Task", description: "Could not update task position. Re-fetching board.", variant: "destructive" });
        if (currentBoard) fetchBoardData(currentBoard.id);
    }
};

  const handleArchiveTask = async (taskToArchive: Task) => {
    if (!user || !currentBoard) return;

    const originalBoardTasks = [...boardTasks];
    const originalBoardState = currentBoard ? JSON.parse(JSON.stringify(currentBoard)) : null;

    setBoardTasks(prevTasks => prevTasks.filter(t => t.id !== taskToArchive.id));
    const updatedColumns = currentBoard.columns.map(col => {
      if (col.taskIds.includes(taskToArchive.id)) {
        return { ...col, taskIds: col.taskIds.filter(tid => tid !== taskToArchive.id) };
      }
      return col;
    });
    setCurrentBoard(prevBoard => prevBoard ? { ...prevBoard, columns: updatedColumns } : null);

    const previouslySelectedTask = selectedTask;
    if (isModalOpen && previouslySelectedTask && previouslySelectedTask.id === taskToArchive.id) {
        setIsModalOpen(false);
        setSelectedTask(null);
    }

    try {
      await updateTaskService(taskToArchive.id, { isArchived: true, archivedAt: new Date().toISOString() });
      await updateBoard(currentBoard.id, { columns: updatedColumns });
      toast({ title: "Task Archived", description: `"${taskToArchive.title}" has been archived.` });
    } catch (error) {
      console.error("Error archiving task:", error);
      toast({ title: "Error Archiving Task", description: "Could not archive task. Reverting.", variant: "destructive" });
      setBoardTasks(originalBoardTasks);
      if (originalBoardState) setCurrentBoard(originalBoardState);
       if (previouslySelectedTask && previouslySelectedTask.id === taskToArchive.id) {
         setSelectedTask(previouslySelectedTask);
         setIsModalOpen(true);
       }
    }
  };

  const handleUpdateColumnName = async (columnId: string, newName: string) => {
    if (!currentBoard || !user) {
      toast({ title: "Error", description: "Cannot update column name: No board or user.", variant: "destructive" });
      return;
    }

    const oldColumns = currentBoard.columns;
    const updatedColumns = oldColumns.map(col =>
      col.id === columnId ? { ...col, name: newName } : col
    );

    setCurrentBoard(prevBoard =>
      prevBoard ? { ...prevBoard, columns: updatedColumns } : null
    );

    try {
      await updateBoard(currentBoard.id, { columns: updatedColumns });
      toast({ title: "Column Renamed", description: `Column renamed to "${newName}".` });
    } catch (error) {
      console.error("Error updating column name in Firestore:", error);
      toast({ title: "Error Renaming Column", description: "Failed to save column name. Reverting.", variant: "destructive" });
      setCurrentBoard(prevBoard =>
        prevBoard ? { ...prevBoard, columns: oldColumns } : null
      );
    }
  };

  const handleToggleTaskCompleted = async (taskId: string, completed: boolean) => {
    if (!user || !currentBoard) {
      toast({ title: "Error", description: "Cannot update task: No board or user.", variant: "destructive" });
      return;
    }
    
    const originalTasks = [...boardTasks];
    setBoardTasks(prevTasks => 
      prevTasks.map(t => t.id === taskId ? { ...t, isCompleted: completed, updatedAt: new Date().toISOString() } : t)
    );

    try {
      await updateTaskService(taskId, { isCompleted: completed });
      toast({ 
        title: "Task Updated", 
        description: `Task marked as ${completed ? 'complete' : 'incomplete'}.` 
      });
    } catch (error) {
      console.error("Error updating task completion status:", error);
      toast({ title: "Error Updating Task", description: "Could not save task completion status. Reverting.", variant: "destructive" });
      setBoardTasks(originalTasks); // Revert optimistic update
    }
  };


  const activeTasks = boardTasks.filter(task => !task.isArchived);

  if (isLoadingBoard) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Loading board...</p>
      </div>
    );
  }

  if (!currentBoard) {
    return null;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Board Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between p-3 bg-background shadow-sm flex-shrink-0">
        <h1 className="text-lg font-medium truncate pr-2">{currentBoard.name}</h1>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <Button
            size="sm"
            onClick={() => handleAddTask(currentBoard.columns[0]?.id ?? '')}
            disabled={currentBoard.columns.length === 0}
            variant="default"
          >
            <Plus className="mr-1 h-3 w-3" /> New Task
          </Button>
        </div>
      </div>

      {/* Kanban Board Area */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
        <KanbanBoard
          boardColumns={currentBoard.columns}
          allTasksForBoard={activeTasks}
          creatorProfiles={userProfiles}
          onTaskClick={handleTaskClick}
          onAddTask={handleAddTask}
          onAddColumn={handleAddColumn}
          onTaskDrop={handleTaskDrop}
          isAddingColumn={isAddingColumn}
          setIsAddingColumn={setIsAddingColumn}
          onUpdateColumnName={handleUpdateColumnName}
          onToggleTaskCompleted={handleToggleTaskCompleted} 
        />
      </div>

      {selectedTask && (
        <TaskDetailsModal
          task={selectedTask}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onUpdateTask={handleUpdateTask}
          onArchiveTask={handleArchiveTask}
        />
      )}
    </div>
  );
}

