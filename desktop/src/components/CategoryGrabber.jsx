import { useState } from 'react'
import { generateId } from '@habit-tracker/core'

function CategoryGrabber({ categories, onDrop }) {
  const [isCreating, setIsCreating] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] = useState('#60a5fa')

  const handleDragStart = (e, categoryId) => {
    e.dataTransfer.setData('categoryId', categoryId)
    e.dataTransfer.setData('type', 'existing-category')
  }

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return

    const newCategory = {
      id: generateId(),
      name: newCategoryName.trim(),
      color: newCategoryColor,
      order: categories.length,
      active: true
    }

    // Pass the category object and indicate it's new
    onDrop(newCategory, true)

    setNewCategoryName('')
    setIsCreating(false)
  }

  return (
    <div className="category-grabber">
      <h4>Categories</h4>
      
      <div className="categories-list">
        {categories.map(category => (
          <div
            key={category.id}
            className="category-chip"
            draggable
            onDragStart={(e) => handleDragStart(e, category.id)}
            style={{ 
              backgroundColor: category.color,
              opacity: 0.8
            }}
          >
            {category.name}
          </div>
        ))}

        {isCreating ? (
          <div className="new-category-form">
            <input
              type="text"
              placeholder="Category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              autoFocus
            />
            <input
              type="color"
              value={newCategoryColor}
              onChange={(e) => setNewCategoryColor(e.target.value)}
            />
            <button onClick={handleCreateCategory}>Add</button>
            <button onClick={() => setIsCreating(false)}>Cancel</button>
          </div>
        ) : (
          <button 
            className="add-category-btn"
            onClick={() => setIsCreating(true)}
          >
            + Add Category
          </button>
        )}
      </div>

      <p className="drag-hint">Drag a category to the board to add a marker</p>
    </div>
  )
}

export default CategoryGrabber
