	import circular from 'circular';
import css from 'global/css';
import removeFromArray from 'utils/removeFromArray';
import resolveRef from 'shared/resolveRef';
import makeTransitionManager from 'shared/makeTransitionManager';

var runloop,

	dirty = false,
	flushing = false,
	pendingCssChanges,

	lockedAttributes = [],

	unresolved = [],

	views = [],
	postViewUpdateTasks = [],
	postModelUpdateTasks = [],

	viewmodels = [],
	transitionManager;

runloop = {
	start: function ( instance, callback ) {
		this.addViewmodel( instance.viewmodel );

		if ( !flushing ) {
			// create a new transition manager
			transitionManager = makeTransitionManager( callback, transitionManager );
		}
	},

	end: function () {
		if ( flushing ) {
			// TODO is this still necessary? probably not
			attemptKeypathResolution();
			return;
		}

		flushing = true;
		do {
			flushChanges();
		} while ( dirty );
		flushing = false;

		transitionManager.init();
		transitionManager = transitionManager._previous;
	},

	addViewmodel: function ( viewmodel ) {
		if ( viewmodel && viewmodels.indexOf( viewmodel ) === -1 ) {
			viewmodels.push( viewmodel );
		}
	},

	registerTransition: function ( transition ) {
		transition._manager = transitionManager;
		transitionManager.push( transition );
	},

	addView: function ( view ) {
		views.push( view );
	},

	lockAttribute: function ( attribute ) {
		attribute.locked = true;
		lockedAttributes.push( attribute );
	},

	scheduleCssUpdate: function () {
		// if runloop isn't currently active, we need to trigger change immediately
		if ( !flushing ) {
			css.update();
		} else {
			pendingCssChanges = true;
		}
	},

	addUnresolved: function ( thing ) {
		dirty = true;
		unresolved.push( thing );
	},

	removeUnresolved: function ( thing ) {
		removeFromArray( unresolved, thing );
	},

	// synchronise node detachments with transition ends
	detachWhenReady: function ( thing ) {
		transitionManager.detachQueue.push( thing );
	},

	afterModelUpdate: function ( task ) {
		dirty = true;
		postModelUpdateTasks.push( task );
	},

	afterViewUpdate: function ( task ) {
		dirty = true;
		postViewUpdateTasks.push( task );
	}
};

circular.runloop = runloop;
export default runloop;

function flushChanges () {
	var thing, changeHash;

	while ( thing = viewmodels.shift() ) {
		changeHash = thing.applyChanges();

		if ( changeHash ) {
			thing.ractive.fire( 'change', changeHash );
		}
	}

	attemptKeypathResolution();

	// These changes may have knock-on effects, so we need to keep
	// looping until the system is settled
	while ( dirty ) {
		dirty = false;

		while ( thing = postModelUpdateTasks.pop() ) {
			thing();
		}

		attemptKeypathResolution();
	}

	// Now that changes have been fully propagated, we can update the DOM
	// and complete other tasks
	while ( thing = views.pop() ) {
		thing.update();
	}

	while ( thing = postViewUpdateTasks.pop() ) {
		thing();
	}

	// If updating the view caused some model blowback - e.g. a triple
	// containing <option> elements caused the binding on the <select>
	// to update - then we start over
	if ( viewmodels.length ) return flushChanges();

	// Unlock attributes (twoway binding)
	while ( thing = lockedAttributes.pop() ) {
		thing.locked = false;
	}

	if ( pendingCssChanges ) {
		css.update();
		pendingCssChanges = false;
	}
}

function attemptKeypathResolution () {
	var array, thing, keypath;

	if ( !unresolved.length ) {
		return;
	}

	// see if we can resolve any unresolved references
	array = unresolved.splice( 0, unresolved.length );
	while ( thing = array.pop() ) {
		if ( thing.keypath ) {
			continue; // it did resolve after all
		}

		keypath = resolveRef( thing.root, thing.ref, thing.parentFragment );

		if ( keypath !== undefined ) {
			// If we've resolved the keypath, we can initialise this item
			thing.resolve( keypath );
		} else {
			// If we can't resolve the reference, try again next time
			unresolved.push( thing );
		}
	}
}